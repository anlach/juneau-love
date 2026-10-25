#!/usr/bin/env python3
"""test_relay_submit.py — regression test for the mail relay's :465 GoTrue
submission shim (infra/mail/relay.ts).

Spawns the REAL relay.ts under deno with a throwaway TLS cert and a local
fake-Maddy sink, then drives the shim over implicit TLS the way GoTrue's
pinned gomail does (EHLO, AUTH PLAIN, MAIL, RCPT, DATA):

  1. valid session  — GoTrue's exact message shape (single-part
                      quoted-printable text/html) → 250 OK, and the sink
                      receives the re-sent mail (multipart/alternative with
                      the rendered HTML embedded in a base64 part, plus a
                      generated text part).
  2. bad-AUTH session — AUTH PLAIN with the wrong password. The shim must
                      reject it and KEEP RUNNING. (Before the fix the whole
                      relay process died here with "Uncaught (in promise)
                      TypeError: Cannot convert object to primitive value":
                      conn.remoteAddr is a null-prototype object in
                      Deno 2.9.7, so ${conn.remoteAddr} in the error path
                      throws while handling the original error. One bad
                      AUTH — e.g. from an internet scanner — killed the
                      mail path for every edge function; observed in
                      production 2026-10-25 02:49:32 UTC.)
  3. recovery       — a valid session immediately after the bad one →
                      250 OK (the relay is still serving).
  4. template-URL   — GoTrue's degenerate case observed in production
                      2026-10-25: the rendered HTML body is just the
                      template URL itself (GoTrue's fetch came back with
                      the URL string as the body, so the guest received
                      an email whose entire content was the link to the
                      template file). The shim must fetch that URL and
                      embed the real document instead.

Requires: deno 2.x and openssl on PATH. Nothing else (stdlib only).
Run:  python3 infra/mail/test_relay_submit.py
"""

import base64
import http.server
import os
import re
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RELAY = os.path.join(REPO, "infra", "mail", "relay.ts")

SUBMIT_USER = "notify@juneau.love"
SUBMIT_PASSWORD = "test-submit-password"
HTTP_TOKEN = "test-relay-token"

# The HTML the fake GoTrue "renders" — must survive the round trip.
MARKER_HTML = "juneau-love-embedded-confirmation-marker"
HTML = (
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>Confirm</title></head>"
    "<body style=\"background:#faf7f6;\"><div style=\"max-width:480px;margin:0 auto;\">"
    "<p style=\"font-size:18px;\">juneau.love</p>"
    "<h1 style=\"font-size:20px;\">Hi Tester, confirm your email address</h1>"
    "<p>You registered on juneau.love with tester@umich.edu. "
    f"Click the button below. {MARKER_HTML}</p>"
    "<p><a href=\"https://example.test/auth/v1/verify?token=test&amp;type=signup\">"
    "Confirm my email address</a></p>"
    "<p>End of email.</p>"
    "</div></body></html>"
)
RECIPIENT = "tester@umich.edu"
SUBJECT = "Confirm your juneau.love email"

# Served by a local HTTP server; what a *correct* template fetch yields.
MARKER_RESOLVED = "juneau-love-resolved-template-marker"
RESOLVED_DOC = (
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>Confirm</title></head>"
    "<body><h1>Hi Tester, confirm your email address</h1>"
    f"<p>Real document from the template server. {MARKER_RESOLVED}</p>"
    "</body></html>"
)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def qp_encode(text, limit=76):
    out = []
    for line in text.split("\n"):
        enc = []
        for ch in line:
            if ch in "\r" or (33 <= ord(ch) <= 126 and ch != "="):
                enc.append(ch)
            else:
                enc.append("=" + format(ord(ch), "02X"))
        s = "".join(enc)
        for i in range(0, len(s), limit):
            out.append(s[i : i + limit])
    return "\r\n".join(out) + "\r\n"


def message_with_body(body):
    """GoTrue-shaped single-part QP text/html message with a given body."""
    return (
        "From: juneau.love <notify@juneau.love>\r\n"
        f"To: {RECIPIENT}\r\n"
        f"Subject: {SUBJECT}\r\n"
        "Message-ID: <repro-test@asuupanisvfxvbmdpcxt.supabase.co>\r\n"
        "Date: Sun, 25 Oct 2026 03:00:00 +0000\r\n"
        "Mime-Version: 1.0\r\n"
        "Content-Type: text/html; charset=UTF-8\r\n"
        "Content-Transfer-Encoding: quoted-printable\r\n"
        "\r\n" + qp_encode(body)
    )


def gotrue_message():
    """The message GoTrue v2.197.0 (pinned gomail) submits: single-part
    text/html, quoted-printable, no plain part, Message-ID @supabase.co."""
    return message_with_body(HTML)


class TemplateServer:
    """Stands in for https://juneau.love/email/confirmation.html."""

    def __init__(self, port, doc):
        docb = doc.encode()

        class H(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(docb)))
                self.end_headers()
                self.wfile.write(docb)

            def log_message(self, *a):
                pass

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), H)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()


class Sink:
    """Fake Maddy: plain-TCP SMTP server that captures DATA payloads."""

    def __init__(self, port):
        self.port = port
        self.messages = []
        self.lock = threading.Lock()
        self.srv = socket.socket()
        self.srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.srv.bind(("127.0.0.1", port))
        self.srv.listen(8)
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self):
        while True:
            try:
                conn, _ = self.srv.accept()
            except OSError:
                return
            threading.Thread(target=self._handle, args=(conn,), daemon=True).start()

    def _handle(self, conn):
        conn.sendall(b"220 maddy-sink ESMTP\r\n")
        data = b""
        indata = False
        buf = b""
        try:
            while True:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                buf += chunk
                while b"\r\n" in buf:
                    line, buf = buf.split(b"\r\n", 1)
                    if indata:
                        if line == b".":
                            indata = False
                            conn.sendall(b"250 2.0.0 OK\r\n")
                            with self.lock:
                                self.messages.append(data.decode())
                        else:
                            if line.startswith(b".."):
                                line = line[1:]
                            data += line + b"\r\n"
                        continue
                    u = line.upper()
                    if u.startswith(b"EHLO"):
                        conn.sendall(b"250-maddy-sink\r\n250 8BITMIME\r\n")
                    elif u.startswith(b"MAIL"):
                        conn.sendall(b"250 2.1.0\r\n")
                    elif u.startswith(b"RCPT"):
                        conn.sendall(b"250 2.1.5\r\n")
                    elif u.startswith(b"DATA"):
                        indata = True
                        conn.sendall(b"354 go\r\n")
                    elif u.startswith(b"QUIT"):
                        conn.sendall(b"221 bye\r\n")
                        return
                    else:
                        conn.sendall(b"250 ok\r\n")
        except OSError:
            pass
        finally:
            conn.close()


class Client:
    """Implicit-TLS SMTP client (GoTrue's pinned gomail: port 465 =
    immediate TLS, AUTH PLAIN)."""

    def __init__(self, port):
        raw = socket.create_connection(("127.0.0.1", port), timeout=10)
        ctx = ssl.SSLContext()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        self.t = ctx.wrap_socket(raw, server_hostname="127.0.0.1")
        self.t.settimeout(10)
        self.banner = self._line()

    def _line(self):
        data = b""
        while not data.endswith(b"\r\n"):
            b = self.t.recv(1)
            if not b:
                raise ConnectionError("connection closed")
            data += b
        return data[:-2].decode()

    def response(self):
        """Read one possibly multi-line SMTP response ('250-' continuations)."""
        lines = []
        while True:
            line = self._line()
            lines.append(line)
            if len(line) < 4 or line[3] == " ":
                return lines

    def cmd(self, line):
        self.t.sendall(line.encode() + b"\r\n")
        return self.response()

    def code(self, lines):
        return lines[-1][:3] if lines and len(lines[-1]) >= 3 else ""

    def send_data(self, raw):
        self.t.sendall(raw.encode())

    def close(self):
        try:
            self.t.close()
        except OSError:
            pass


def main():
    for tool in ("deno", "openssl"):
        found = any(
            os.path.isfile(os.path.join(d, tool))
            for d in os.environ.get("PATH", "").split(os.pathsep)
            if os.path.isdir(d)
        )
        if not found:
            print(f"FAIL: {tool} not on PATH")
            return 1

    tmp = tempfile.mkdtemp(prefix="relay-submit-test-")
    cert = os.path.join(tmp, "cert.pem")
    key = os.path.join(tmp, "key.pem")
    subprocess.run(
        [
            "openssl", "req", "-x509", "-newkey", "rsa:2048",
            "-keyout", key, "-out", cert, "-days", "2", "-nodes",
            "-subj", "/CN=127.0.0.1",
            "-addext", "subjectAltName=IP:127.0.0.1",
        ],
        check=True,
        capture_output=True,
    )

    http_port, sink_port, submit_port = free_port(), free_port(), free_port()
    tpl_port = free_port()
    sink = Sink(sink_port)
    tpl_url = f"http://127.0.0.1:{tpl_port}/confirmation.html"
    TemplateServer(tpl_port, RESOLVED_DOC)
    capture_dir = os.path.join(tmp, "captures")
    os.mkdir(capture_dir)

    env = dict(os.environ)
    env.update(
        {
            "RELAY_LISTEN": f"127.0.0.1:{http_port}",
            "RELAY_SMTP": f"127.0.0.1:{sink_port}",
            "RELAY_HELO": "mail.juneau.love",
            "RELAY_FROM": f"juneau.love <{SUBMIT_USER}>",
            "MAIL_RELAY_TOKEN": HTTP_TOKEN,
            "SMTP_SUBMIT_LISTEN": f"127.0.0.1:{submit_port}",
            "SMTP_SUBMIT_CERT": cert,
            "SMTP_SUBMIT_KEY": key,
            "SMTP_SUBMIT_USER": SUBMIT_USER,
            "SMTP_SUBMIT_PASSWORD": SUBMIT_PASSWORD,
            "SMTP_SUBMIT_CAPTURE_DIR": capture_dir,
        }
    )
    relay = subprocess.Popen(
        ["deno", "run", "--allow-net", "--allow-env", f"--allow-read={tmp}",
         f"--allow-write={capture_dir}", RELAY],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    # Drain the relay's output continuously so checks never block on it.
    relay_log = []
    log_lock = threading.Lock()

    def drain():
        for line in relay.stdout:
            with log_lock:
                relay_log.append(line.rstrip())

    threading.Thread(target=drain, daemon=True).start()

    failures = []

    def check(name, ok, detail=""):
        print(f"  {'PASS' if ok else 'FAIL'}: {name}" + (f" — {detail}" if detail and not ok else ""))
        if not ok:
            failures.append(name)

    def log_snapshot():
        with log_lock:
            return "\n".join(relay_log)

    try:
        # Wait for the submit listener line.
        up = False
        start = time.time()
        while time.time() - start < 20:
            if relay.poll() is not None:
                break
            if "GoTrue submission listener on" in log_snapshot():
                up = True
                break
            time.sleep(0.2)
        if not up:
            print("FAIL: relay did not start; output:")
            print(log_snapshot())
            return 1
        print("relay up (submit listener running)")

        # -- 1. valid session ------------------------------------------------
        print("\n[1] valid GoTrue-shaped session")
        try:
            c = Client(submit_port)
            check("banner 220", c.banner.startswith("220"), c.banner)
            check("EHLO caps", c.code(c.cmd("EHLO repro.test")) == "250")
            token = base64.b64encode(f"\0{SUBMIT_USER}\0{SUBMIT_PASSWORD}".encode()).decode()
            check("AUTH PLAIN accepted", c.code(c.cmd(f"AUTH PLAIN {token}")) == "235")
            check("MAIL FROM ok", c.code(c.cmd(f"MAIL FROM:<{SUBMIT_USER}>")) == "250")
            check("RCPT TO ok", c.code(c.cmd(f"RCPT TO:<{RECIPIENT}>")) == "250")
            check("DATA ok", c.code(c.cmd("DATA")) == "354")
            c.send_data(gotrue_message() + "\r\n.\r\n")
            check("message accepted (250)", c.code(c.response()) == "250")
            check("QUIT", c.code(c.cmd("QUIT")) == "221")
            c.close()
        except Exception as e:
            check("valid session completed", False, repr(e))

        time.sleep(0.5)
        with sink.lock:
            got = list(sink.messages)
        check("sink received one message", len(got) == 1, f"got {len(got)}")
        if got:
            m = got[0]
            html_part = re.search(
                r"Content-Type: text/html; charset=utf-8\r\n"
                r"Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--",
                m,
            )
            decoded = (
                base64.b64decode(re.sub(r"\s+", "", html_part.group(1))).decode()
                if html_part
                else ""
            )
            text_part = re.search(
                r"Content-Type: text/plain; charset=utf-8\r\n"
                r"Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--",
                m,
            )
            text_decoded = (
                base64.b64decode(re.sub(r"\s+", "", text_part.group(1))).decode()
                if text_part
                else ""
            )
            check("re-sent mail is multipart/alternative", "multipart/alternative" in m)
            check("rendered HTML embedded in the message", MARKER_HTML in decoded)
            check("text part generated from the HTML", "confirm your email address" in text_decoded)
            check("subject preserved", f"Subject: {SUBJECT}" in m)

        # -- 2. bad-AUTH session (the crash trigger) -------------------------
        print("\n[2] bad-AUTH session (crash trigger)")
        try:
            c = Client(submit_port)
            c.cmd("EHLO repro.test")
            bad = base64.b64encode(f"\0{SUBMIT_USER}\0wrong-password".encode()).decode()
            try:
                resp = c.cmd(f"AUTH PLAIN {bad}")
                print(f"   relay replied: {resp[-1] if resp else '<none>'}")
            except Exception as e:
                print(f"   relay reply: <{type(e).__name__}>")
            c.close()
        except Exception as e:
            print(f"   client note: {e!r}")

        time.sleep(1.0)
        code = relay.poll()
        check("relay process still alive after bad AUTH", code is None, f"exit code {code}")
        if code is None:
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{http_port}/healthz", timeout=3)
                check("relay /healthz still answering", True)
            except Exception as e:
                check("relay /healthz still answering", False, repr(e))
        check(
            "no uncaught TypeError in relay output",
            "Cannot convert object to primitive value" not in log_snapshot()
            and "Uncaught (in promise)" not in log_snapshot(),
            log_snapshot()[-400:],
        )

        # -- 3. recovery ------------------------------------------------------
        print("\n[3] recovery — valid session after the bad one")
        try:
            c = Client(submit_port)
            check("banner 220 (recovery)", c.banner.startswith("220"), c.banner)
            check("EHLO caps (recovery)", c.code(c.cmd("EHLO repro.test")) == "250")
            token = base64.b64encode(f"\0{SUBMIT_USER}\0{SUBMIT_PASSWORD}".encode()).decode()
            check("AUTH PLAIN accepted again", c.code(c.cmd(f"AUTH PLAIN {token}")) == "235")
            check("MAIL FROM ok (recovery)", c.code(c.cmd(f"MAIL FROM:<{SUBMIT_USER}>")) == "250")
            check("RCPT TO ok (recovery)", c.code(c.cmd(f"RCPT TO:<{RECIPIENT}>")) == "250")
            check("DATA ok (recovery)", c.code(c.cmd("DATA")) == "354")
            c.send_data(gotrue_message() + "\r\n.\r\n")
            check("recovery message accepted (250)", c.code(c.response()) == "250")
            c.close()
        except Exception as e:
            check("recovery session completed", False, repr(e))

        # -- 4. degenerate body: bare template URL -------------------------
        print("\n[4] degenerate GoTrue body (bare template URL) is resolved")
        try:
            c = Client(submit_port)
            c.cmd("EHLO repro.test")
            token = base64.b64encode(f"\0{SUBMIT_USER}\0{SUBMIT_PASSWORD}".encode()).decode()
            c.cmd(f"AUTH PLAIN {token}")
            c.cmd(f"MAIL FROM:<{SUBMIT_USER}>")
            c.cmd(f"RCPT TO:<{RECIPIENT}>")
            check("DATA ok (tpl-url)", c.code(c.cmd("DATA")) == "354")
            c.send_data(message_with_body(tpl_url) + "\r\n.\r\n")
            check("tpl-url message accepted (250)", c.code(c.response()) == "250")
            c.close()
        except Exception as e:
            check("tpl-url session completed", False, repr(e))

        time.sleep(0.5)
        with sink.lock:
            got = list(sink.messages)
        check("sink received the tpl-url message", len(got) >= 2, f"got {len(got)}")
        if len(got) >= 2:
            m = got[-1]
            html_part = re.search(
                r"Content-Type: text/html; charset=utf-8\r\n"
                r"Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--",
                m,
            )
            decoded = (
                base64.b64decode(re.sub(r"\s+", "", html_part.group(1))).decode()
                if html_part
                else ""
            )
            text_part = re.search(
                r"Content-Type: text/plain; charset=utf-8\r\n"
                r"Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--",
                m,
            )
            text_decoded = (
                base64.b64decode(re.sub(r"\s+", "", text_part.group(1))).decode()
                if text_part
                else ""
            )
            check("real document embedded (not the bare URL)", MARKER_RESOLVED in decoded)
            check("text part derived from the resolved document", "confirm your email address" in text_decoded)
            check("relay logged the template resolution", "resolved template URL" in log_snapshot())

        # -- 5. client vanishes mid-DATA -------------------------------------
        print("\n[5] client closes mid-DATA (early EOF must be logged, not fatal)")
        try:
            c = Client(submit_port)
            c.cmd("EHLO repro.test")
            token = base64.b64encode(f"\0{SUBMIT_USER}\0{SUBMIT_PASSWORD}".encode()).decode()
            c.cmd(f"AUTH PLAIN {token}")
            c.cmd(f"MAIL FROM:<{SUBMIT_USER}>")
            c.cmd(f"RCPT TO:<{RECIPIENT}>")
            check("DATA ok (early-close)", c.code(c.cmd("DATA")) == "354")
            # Headers only, no blank line, no terminator — then the socket
            # goes away (what GoTrue's client appears to do in production).
            c.send_data(gotrue_message().split("\r\n\r\n")[0])
            c.close()
        except Exception as e:
            check("early-close session sent", False, repr(e))

        time.sleep(1.0)
        code = relay.poll()
        check("relay process still alive after early EOF", code is None, f"exit code {code}")
        check(
            "early EOF logged for diagnosis",
            "DATA ended before terminator" in log_snapshot(),
            log_snapshot()[-400:],
        )
        captured = os.listdir(capture_dir) if os.path.isdir(capture_dir) else []
        check("submissions were captured to disk", len(captured) >= 2, f"{captured}")
        if captured:
            first = sorted(captured)[0]
            with open(os.path.join(capture_dir, first), "rb") as fh:
                body = fh.read().decode("utf-8", "replace")
            check("capture is a full GoTrue-shaped message", "Content-Transfer-Encoding: quoted-printable" in body and "\r\n\r\n" in body, body[:120])

    finally:
        relay.terminate()
        try:
            relay.wait(timeout=3)
        except subprocess.TimeoutExpired:
            relay.kill()
        sink.srv.close()

    print()
    if failures:
        print(f"RESULT: FAIL ({len(failures)} check(s) failed: {', '.join(failures)})")
        return 1
    print("RESULT: PASS (valid session, bad-AUTH survived, recovery OK, template URL resolved, early-EOF logged + captured)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
