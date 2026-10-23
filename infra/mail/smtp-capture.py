#!/usr/bin/env python3
"""smtp-capture.py — logging SMTP sink that captures GoTrue's submission credentials.

Purpose
-------
Diagnose "GoTrue gets 535 5.7.8 Invalid credentials from Maddy although the
Management API returns the right smtp_user/smtp_pass" by capturing the exact
credentials the *running* GoTrue process presents during SMTP AUTH — without
involving Supabase.

Why this works (verified against GoTrue v2.197.0 + the exact gomail commit
it pins, gopkg.in/gomail.v2 v2.0.0-20160411212932-81ebce5c23df):

- GoTrue's SMTP path is internal/mailer/mailmeclient: per-mail
  gomail.NewDialer(host, port, user, pass).DialAndSend(msg).
- gomail only uses TLS if the server advertises STARTTLS (or on port 465).
  A server that advertises no STARTTLS receives AUTH in the clear.
- gomail picks AUTH PLAIN when the server advertises it (one line,
  base64("\\0user\\0pass")); AUTH LOGIN otherwise (two base64 challenges).

This sink advertises `AUTH PLAIN LOGIN` and no STARTTLS, logs the full
session transcript, decodes the credentials, and prints a SUMMARY line.
It never delivers mail: accepted messages are discarded.

Security notes
--------------
- The captured password is written to the log in the clear. Run it with a
  mode-0600 --log file, capture what you need, delete the log, and take the
  listener down (it does not authenticate inbound clients).
- For a hosted capture the listener is briefly reachable on the public
  mail.juneau.love host on a spare port. Limit the window.

Usage
-----
  # on the VPS (hosted capture; open the port in the firewall first):
  python3 smtp-capture.py --port 1025 --log /var/log/smtp-capture.log

  # locally, against the probe (accept everything, stop after one session):
  python3 smtp-capture.py --port 1025 --once

  # reproduce the production failure signature (always 535):
  python3 smtp-capture.py --port 1025 --mode reject
"""

import argparse
import base64
import hashlib
import os
import re
import socket
import sys
import threading
from datetime import datetime, timezone

CRLF = b"\r\n"
READ_TIMEOUT = 30.0
MAX_DATA_BYTES = 256 * 1024


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class Logger:
    def __init__(self, fh, show_pass: bool):
        self.fh = fh
        self.show_pass = show_pass
        self.lock = threading.Lock()

    def line(self, msg: str):
        with self.lock:
            self.fh.write(f"{now()} {msg}\n")
            self.fh.flush()


def decode_plain(token: str) -> tuple[str, str]:
    raw = base64.b64decode(token.encode("ascii", "replace"))
    parts = raw.split(b"\x00", 2)
    if len(parts) != 3:
        return "<unparsable>", ""
    return parts[1].decode("utf-8", "replace"), parts[2].decode("utf-8", "replace")


def b64line(line: str) -> str:
    return base64.b64decode(line.strip().encode("ascii", "replace")).decode(
        "utf-8", "replace"
    )


class Session:
    def __init__(self, conn: socket.socket, addr, args, log: Logger):
        self.conn = conn
        self.addr = addr
        self.args = args
        self.log = log
        self.peer = f"{addr[0]}:{addr[1]}"
        self.user = None
        self.passw = None
        self.auth_mech = None
        self.mail_from = None
        self.rcpt = []
        self.data_lines = []
        self.result = "no_session"

    # -- plumbing ---------------------------------------------------------
    def send(self, s: str):
        try:
            self.conn.sendall((s + "\r\n").encode())
        except OSError as e:
            self.log.line(f"peer={self.peer} S-send-error {e!r}")

    def read_line(self) -> str:
        buf = b""
        self.conn.settimeout(READ_TIMEOUT)
        while not buf.endswith(CRLF):
            chunk = self.conn.recv(1)
            if not chunk:
                raise ConnectionError("client closed")
            buf += chunk
            if len(buf) > 65536:
                raise ConnectionError("line too long")
        return buf[:-2].decode("utf-8", "replace")

    def read_data(self):
        self.conn.settimeout(READ_TIMEOUT)
        buf = b""
        while not buf.endswith(b"\r\n.\r\n"):
            chunk = self.conn.recv(65536)
            if not chunk:
                raise ConnectionError("client closed during DATA")
            buf += chunk
            if len(buf) > MAX_DATA_BYTES:
                self.log.line(f"peer={self.peer} data truncated at {MAX_DATA_BYTES} bytes")
                return buf.decode("utf-8", "replace")
        return buf[:-5].decode("utf-8", "replace")

    def summary(self):
        pw_field = ""
        if self.passw is not None:
            pw_field = (
                f" pass={self.passw}" if self.log.show_pass
                else f" pass=<masked len={len(self.passw)}>"
            )
            pw_field += f" pass_sha256={hashlib.sha256(self.passw.encode()).hexdigest()}"
        user_field = f" user={self.user}" if self.user is not None else " user=<none>"
        self.log.line(
            "SUMMARY peer=" + self.peer
            + f" auth={self.auth_mech or '<none>'}"
            + user_field + pw_field
            + f" mail_from={self.mail_from or '<none>'}"
            + f" rcpt={self.rcpt or '<none>'}"
            + f" result={self.result}"
        )

    # -- protocol ---------------------------------------------------------
    def run(self):
        try:
            self.conn.settimeout(READ_TIMEOUT)
            self.send("220 smtp-capture ESMTP (logging sink — no delivery)")
            self.log.line(f"peer={self.peer} connected")
            self.handshake()
            self.log.line(f"peer={self.peer} session over")
        except (ConnectionError, TimeoutError, OSError) as e:
            self.result = f"error:{type(e).__name__}"
            self.log.line(f"peer={self.peer} session error {e!r}")
        finally:
            self.summary()
            try:
                self.conn.close()
            except OSError:
                pass

    def handshake(self):
        authed = False
        data_done = False
        while True:
            line = self.read_line()
            self.log.line(f"peer={self.peer} C: {line}")
            parts = line.split(None, 2)
            cmd = parts[0].upper() if parts else ""

            if cmd in ("EHLO", "HELO"):
                if cmd == "EHLO":
                    self.send("250-smtp-capture")
                    self.send("250-AUTH PLAIN LOGIN")
                    self.send("250 8BITMIME")
                else:
                    self.send("250 smtp-capture")
            elif cmd == "AUTH":
                # everything after "AUTH " (mechanism + initial response)
                authed = self.do_auth(line[4:].strip())
                if authed is False:  # rejected: server closes
                    return
            elif cmd == "MAIL":
                m = re.match(r"FROM:\s*<([^>]*)>", line[4:].strip(), re.I)
                self.mail_from = m.group(1) if m else line[4:].strip()
                self.send("250 2.1.0 OK")
            elif cmd == "RCPT":
                m = re.match(r"TO:\s*<([^>]*)>", line[4:].strip(), re.I)
                self.rcpt.append(m.group(1) if m else line[4:].strip())
                self.send("250 2.1.5 OK")
            elif cmd == "DATA":
                self.send("354 End data with <CR><LF>.<CR><LF>")
                data = self.read_data()
                self.data_lines.append(data)
                self.log.line(f"peer={self.peer} DATA {len(data)} bytes captured")
                for dl in data.splitlines():
                    self.log.line(f"peer={self.peer} D: {dl}")
                self.send("250 2.0.0 OK: message accepted (discarded, logging only)")
                data_done = True
                self.result = "accepted" if authed or self.user is None else self.result
            elif cmd == "QUIT":
                self.send("221 2.0.0 Bye")
                if self.result == "no_session":
                    self.result = "no_auth_seen" if self.user is None else "auth_ok_no_mail"
                return
            elif cmd in ("RSET", "NOOP", "HELP", "VRFY", "EXPN"):
                self.send("250 2.0.0 OK")
            else:
                self.send("502 5.5.2 Command not implemented")

            if data_done and cmd == "DATA":
                # GoTrue (gomail) sends QUIT right after; keep the loop so we
                # still record it.
                continue

    def do_auth(self, rest: str) -> bool:
        mech = rest.split(None, 1)[0].upper() if rest else ""
        if mech == "PLAIN":
            token = rest[5:].strip() if len(rest) > 5 else ""
            if not token:
                self.send("334 ")
                token = self.read_line().strip()
            self.user, self.passw = decode_plain(token)
            self.auth_mech = "PLAIN"
        elif mech == "LOGIN":
            self.send("334 " + base64.b64encode(b"Username:").decode())
            self.user = b64line(self.read_line())
            self.send("334 " + base64.b64encode(b"Password:").decode())
            self.passw = b64line(self.read_line())
            self.auth_mech = "LOGIN"
        else:
            self.send("504 5.5.4 Unrecognized authentication type")
            self.result = "auth_unsupported_mech"
            return False

        self.log.line(
            f"peer={self.peer} AUTH {self.auth_mech} user={self.user!r} "
            f"pass_sha256={hashlib.sha256((self.passw or '').encode()).hexdigest()}"
        )
        if self.args.mode == "reject":
            self.send("535 5.7.8 Invalid credentials")
            self.result = "auth_rejected_535"
            return False
        self.send("235 2.7.0 Authentication successful")
        return True


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--port", type=int, default=1025)
    p.add_argument("--bind", default="0.0.0.0")
    p.add_argument("--mode", choices=["accept", "reject"], default="accept",
                   help="accept: 235 + accept mail (default); reject: always 535 (reproduce prod failure)")
    p.add_argument("--log", default=None, help="log file (created mode 0600); default: stdout")
    p.add_argument("--once", action="store_true", help="exit after the first session")
    p.add_argument("--max-sessions", type=int, default=0, help="exit after N sessions (0 = unlimited)")
    p.add_argument("--mask", action="store_true",
                   help="mask the password in SUMMARY (sha256 still printed)")
    args = p.parse_args()

    if args.log:
        fd = os.open(args.log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        fh = os.fdopen(fd, "a", encoding="utf-8")
    else:
        fh = sys.stdout
    log = Logger(fh, show_pass=not args.mask)

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((args.bind, args.port))
    srv.listen(8)
    print(f"smtp-capture listening on {args.bind}:{args.port} mode={args.mode}", file=sys.stderr)
    print("WARNING: captured credentials are logged in the clear; "
          "restrict the log file and delete it when done.", file=sys.stderr)

    sessions = 0
    lock = threading.Lock()
    try:
        while True:
            conn, addr = srv.accept()
            with lock:
                sessions += 1
                n = sessions
            if args.once and n == 1:
                t = threading.Thread(target=Session(conn, addr, args, log).run, daemon=True)
                t.start()
                t.join()
                print(f"captured one session (see log); exiting", file=sys.stderr)
                return
            if args.max_sessions and n > args.max_sessions:
                conn.close()
                print(f"max-sessions reached; exiting", file=sys.stderr)
                return
            threading.Thread(target=Session(conn, addr, args, log).run, daemon=True).start()
    except KeyboardInterrupt:
        pass
    finally:
        srv.close()
        if args.log:
            fh.close()


if __name__ == "__main__":
    main()
