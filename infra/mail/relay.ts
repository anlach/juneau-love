// relay — HTTP -> SMTP relay for juneau.love's Supabase edge functions,
// plus an SMTP submission listener (port 465) that front-ends GoTrue.
//
// The edge functions cannot open raw TCP (the edge runtime denies
// Deno.connect — its user worker's net permission scope is empty), so every
// email the site sends goes:
//
//   edge function --HTTPS--> nginx (mail.juneau.love)
//              --loopback--> this relay --SMTP--> Maddy (127.0.0.1:25)
//              --direct MX delivery--> internet
//
// GoTrue's auth emails take the same path, one hop longer: GoTrue
// (Supabase custom SMTP) submits to this process's :465 listener, which
// re-sends the mail through the same sendMail() as everything else — see
// the "GoTrue submission shim" section below and knowledge/platform/
// bugs.md for why the shim stays (the message shape was exonerated in the
// 2026-10-26 bisection; it remains the proven, capture-equipped path).
//
// Maddy signs with DKIM; SPF/DMARC come from DNS (see README.md here and
// knowledge/platform/mail.md in the repo).
//
// Zero dependencies. Run with plain Deno:
//
//   deno run --allow-net --allow-env --allow-read=/etc/mail-relay/tls relay.ts
//
// Env (see /etc/mail-relay/env on the VPS):
//   RELAY_LISTEN   default 127.0.0.1:8080  (loopback only — Caddy fronts it)
//   RELAY_SMTP     default 127.0.0.1:25    (Maddy's loopback handoff)
//   RELAY_HELO     default mail.juneau.love
//   RELAY_FROM     default "juneau.love <notify@juneau.love>"
//   MAIL_RELAY_TOKEN  required — the shared bearer token the functions send
//   SMTP_SUBMIT_LISTEN  default 0.0.0.0:465 (GoTrue's submission endpoint)
//   SMTP_SUBMIT_CERT/KEY  default /etc/mail-relay/tls/{fullchain,privkey}.pem
//     (staging copies of the Let's Encrypt cert — the mailrelay user cannot
//     read /etc/letsencrypt; the certbot deploy hook refreshes + restarts)
//   SMTP_SUBMIT_USER  default the RELAY_FROM address (notify@juneau.love)
//   SMTP_SUBMIT_PASSWORD  the SMTP password GoTrue authenticates with
//     (same value as Maddy's /etc/maddy/smtp_passwd). If unset, the submit
//     listener is disabled (HTTP relay still runs — local dev).
//
// Design: knowledge/platform/mail.md (in the juneau-love repo)

const LISTEN = Deno.env.get("RELAY_LISTEN") ?? "127.0.0.1:8080";
const SMTP_TARGET = Deno.env.get("RELAY_SMTP") ?? "127.0.0.1:25";
const HELO = Deno.env.get("RELAY_HELO") ?? "mail.juneau.love";
const FROM = Deno.env.get("RELAY_FROM") ?? "juneau.love <notify@juneau.love>";
const TOKEN = Deno.env.get("MAIL_RELAY_TOKEN") ?? "";
const MESSAGE_ID_DOMAIN = Deno.env.get("RELAY_MESSAGE_ID_DOMAIN") ?? "juneau.love";

const MAX_RECIPIENTS = 10;
const MAX_SUBJECT_LENGTH = 998; // RFC 5322 keeps subject headers sane below this
const MAX_BODY_BYTES = 256 * 1024;
const SMTP_TIMEOUT_MS = 20_000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ADDRESS_LENGTH = 254; // RFC 5321

// The envelope sender: the bare address inside RELAY_FROM.
const FROM_ADDRESS = (FROM.includes("<") ? FROM.match(/<([^>]+)>/)?.[1] : FROM)?.trim() ?? "";
if (!EMAIL_RE.test(FROM_ADDRESS)) {
  throw new Error(`RELAY_FROM does not contain a valid address: ${FROM}`);
}

// GoTrue submission shim (see header comment).
const SUBMIT_LISTEN = Deno.env.get("SMTP_SUBMIT_LISTEN") ?? "0.0.0.0:465";
const SUBMIT_CERT = Deno.env.get("SMTP_SUBMIT_CERT") ?? "/etc/mail-relay/tls/fullchain.pem";
const SUBMIT_KEY = Deno.env.get("SMTP_SUBMIT_KEY") ?? "/etc/mail-relay/tls/privkey.pem";
// The account GoTrue must authenticate as: Supabase's `smtp_user`.
const SUBMIT_USER = Deno.env.get("SMTP_SUBMIT_USER") ?? FROM_ADDRESS;
const SUBMIT_PASSWORD = Deno.env.get("SMTP_SUBMIT_PASSWORD") ?? "";
// When set, every submission's raw DATA (de-dot-stuffed) is saved here so
// what GoTrue actually sends can be inspected. Last 20 files kept.
const SUBMIT_CAPTURE_DIR = Deno.env.get("SMTP_SUBMIT_CAPTURE_DIR") ?? "";

let captureSeq = 0;
async function captureSubmission(rcpts: string[], raw: string, how: string): Promise<void> {
  if (!SUBMIT_CAPTURE_DIR) return;
  try {
    captureSeq += 1;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `${ts}-${captureSeq}.eml`;
    await Deno.writeTextFile(`${SUBMIT_CAPTURE_DIR}/${name}`, raw);
    const entries: string[] = [];
    for await (const e of Deno.readDir(SUBMIT_CAPTURE_DIR)) entries.push(e.name);
    entries.sort();
    for (const old of entries.slice(0, Math.max(0, entries.length - 20))) {
      try { await Deno.remove(`${SUBMIT_CAPTURE_DIR}/${old}`); } catch { /* gone */ }
    }
    console.log(`[submit] captured ${name} bytes=${raw.length} term=${how} rcpt=${rcpts.join(",")}`);
  } catch (e) {
    console.warn(`[submit] capture failed: ${errToString(e)}`);
  }
}

// ---------------------------------------------------------------------------
// HTTP layer
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Constant-time bearer token check. */
function authorized(header: string | null): boolean {
  if (!TOKEN || !header?.startsWith("Bearer ")) return false;
  const provided = header.slice("Bearer ".length);
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(TOKEN);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

interface Mail {
  to: string[];
  subject: string;
  html: string;
  text: string;
}

function validate(body: unknown): { ok: true; mail: Mail } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const { to, subject, html, text } = body as Record<string, unknown>;

  const list = Array.isArray(to) ? to : [to];
  if (list.length === 0 || list.length > MAX_RECIPIENTS) {
    return { ok: false, error: `to must have 1..${MAX_RECIPIENTS} recipients` };
  }
  const addresses = list.map((address) => String(address));
  for (const address of addresses) {
    if (address.length > MAX_ADDRESS_LENGTH || !EMAIL_RE.test(address)) {
      return { ok: false, error: `invalid recipient: ${address.slice(0, 200)}` };
    }
  }
  if (typeof subject !== "string" || subject.length === 0 || subject.length > MAX_SUBJECT_LENGTH) {
    return { ok: false, error: "subject must be a non-empty string" };
  }
  const encoder = new TextEncoder();
  if (typeof html !== "string" || encoder.encode(html).length > MAX_BODY_BYTES) {
    return { ok: false, error: "html must be a string" };
  }
  if (typeof text !== "string" || encoder.encode(text).length > MAX_BODY_BYTES) {
    return { ok: false, error: "text must be a string" };
  }
  return { ok: true, mail: { to: addresses, subject, html, text } };
}

// ---------------------------------------------------------------------------
// MIME
// ---------------------------------------------------------------------------

function b64Line(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let out = "";
  for (let i = 0; i < bytes.length; i += 57) {
    if (i > 0) out += "\r\n";
    out += btoa(String.fromCharCode(...bytes.subarray(i, i + 57)));
  }
  return out;
}

/** RFC 2047 encoded-word for subjects with non-ASCII (plain otherwise). */
function encodeSubject(subject: string): string {
  return /^[\x20-\x7e]*$/.test(subject) ? subject : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(subject)))}?=`;
}

function rfc5322Date(d = new Date()): string {
  return d.toUTCString();
}

function buildMessage(mail: Mail): string {
  const boundary = `b-${crypto.randomUUID().replaceAll("-", "")}`;
  const message = [
    `Date: ${rfc5322Date()}`,
    `From: ${FROM}`,
    `To: ${mail.to.join(", ")}`,
    `Subject: ${encodeSubject(mail.subject)}`,
    `Message-ID: <${crypto.randomUUID()}@${MESSAGE_ID_DOMAIN}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64Line(mail.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64Line(mail.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
  // Dot-stuffing (RFC 5321 4.5.2): a leading dot on any line.
  return message.replace(/^\.(\r\n)/gm, "..$1");
}

// ---------------------------------------------------------------------------
// SMTP client (talking to Maddy on loopback)
// ---------------------------------------------------------------------------

// Line reader over the conn's readable stream (Deno 2.x: the legacy
// Deno.Reader API is gone).
class Lines {
  #r: ReadableStreamDefaultReader<Uint8Array>;
  #buf = "";
  #decoder = new TextDecoder();
  constructor(readable: ReadableStream<Uint8Array>) {
    this.#r = readable.getReader();
  }
  async next(): Promise<string | null> {
    for (;;) {
      const nl = this.#buf.indexOf("\n");
      if (nl !== -1) {
        const line = this.#buf.slice(0, nl);
        this.#buf = this.#buf.slice(nl + 1);
        return line.replace(/\r$/, "");
      }
      const { value, done } = await this.#r.read();
      if (done) {
        if (this.#buf.length > 0) {
          const rest = this.#buf;
          this.#buf = "";
          return rest;
        }
        return null;
      }
      this.#buf += this.#decoder.decode(value, { stream: true });
      if (this.#buf.length > 65536) throw new Error("SMTP line too long");
    }
  }
}

/** Read one (possibly multi-line) SMTP response: "250-" continues, "250 " ends. */
async function readResponse(lines: Lines): Promise<{ code: number; text: string }> {
  const got: string[] = [];
  for (let i = 0; ; i++) {
    if (i > 50) throw new Error("too many SMTP response lines");
    const line = await lines.next();
    if (line === null) throw new Error("SMTP connection closed");
    got.push(line);
    if (line.length < 4) break;
    if (line[3] === " ") return { code: Number(line.slice(0, 3)), text: got.join(" ") };
    if (line[3] !== "-") break;
  }
  return { code: Number(got[got.length - 1].slice(0, 3)), text: got.join(" ") };
}

async function sendMail(mail: Mail): Promise<void> {
  const [host, portStr] = SMTP_TARGET.split(":");
  const port = Number(portStr ?? "25");
  const conn = await Deno.connect({ hostname: host, port });
  try {
    await withTimeout(SMTP_TIMEOUT_MS, async () => {
      const lines = new Lines(conn.readable);
      const w = conn.writable.getWriter();

      const say = async (s: string) => {
        await w.write(new TextEncoder().encode(s));
      };

      const banner = await readResponse(lines);
      if (banner.code !== 220) throw new Error(`unexpected banner: ${banner.text}`);

      const ehlo = await (async () => {
        await say(`EHLO ${HELO}\r\n`);
        return readResponse(lines);
      })();
      if (ehlo.code !== 250) throw new Error(`EHLO rejected: ${ehlo.text}`);

      const mailFrom = await (async () => {
        await say(`MAIL FROM:<${FROM_ADDRESS}>\r\n`);
        return readResponse(lines);
      })();
      if (mailFrom.code !== 250) throw new Error(`MAIL FROM rejected: ${mailFrom.text}`);

      for (const rcpt of mail.to) {
        const rc = await (async () => {
          await say(`RCPT TO:<${rcpt}>\r\n`);
          return readResponse(lines);
        })();
        if (rc.code !== 250 && rc.code !== 251) {
          throw new Error(`RCPT TO <${rcpt}> rejected: ${rc.text}`);
        }
      }

      const data = await (async () => {
        await say("DATA\r\n");
        return readResponse(lines);
      })();
      if (data.code !== 354) throw new Error(`DATA rejected: ${data.text}`);

      await say(`${buildMessage(mail)}\r\n.\r\n`);
      const done = await readResponse(lines);
      if (done.code !== 250) throw new Error(`message rejected: ${done.text}`);

      await say("QUIT\r\n");
      // All bytes are written and the message already 250-acked; QUIT's
      // 221 and any post-QUIT stream close can race with the server's own
      // teardown, so leave it to the finally-block conn.close().
    });
  } finally {
    conn.close();
  }
}

function withTimeout<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    fn().then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const [listenHost, listenPortStr] = LISTEN.split(":");
const listenPort = Number(listenPortStr ?? "8080");

Deno.serve({ hostname: listenHost, port: listenPort }, async (req) => {
  const path = new URL(req.url).pathname;
  if (req.method === "GET" && path === "/healthz") return json({ ok: true });
  if (req.method !== "POST" || path !== "/send") {
    return json({ error: "not_found" }, 404);
  }
  if (!authorized(req.headers.get("authorization"))) return json({ error: "unauthorized" }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request", detail: "body must be JSON" }, 400);
  }
  const v = validate(body);
  if (!v.ok) return json({ error: "bad_request", detail: v.error }, 400);

  try {
    await sendMail(v.mail);
    return json({ sent: true, recipients: v.mail.to.length });
  } catch (err) {
    console.error(`[relay] send to ${v.mail.to.join(", ")} failed: ${err}`);
    return json({ error: "smtp_failed", detail: String(err) }, 502);
  }
});

console.log(`[relay] listening on ${LISTEN}, handing off to ${SMTP_TARGET} as ${FROM_ADDRESS}`);

// ---------------------------------------------------------------------------
// GoTrue submission shim (port 465)
// ---------------------------------------------------------------------------
//
// Why: GoTrue's pinned mailer only speaks implicit TLS on port 465, so it
// submits to THIS listener and the mail goes out through sendMail() above
// — the shape umich.edu has accepted on every production send. The
// original rationale (umich 451s GoTrue's native shape) was superseded by
// the 2026-10-26 bisection: the 451s tracked degenerate *bodies* (raw
// unrendered template / bare URL / empty), not shape — the inlined GoTrue
// template config now guarantees rendered bodies (knowledge/platform/
// mail.md). The shim remains the proven, capture-equipped path. GoTrue's
// 500-on-send-failure semantics are preserved: a delivery failure returns
// 451 here, GoTrue 500s the signup, and the whole signup (user row
// included) rolls back.
//
// Wire protocol (verified 2026-10-24 against the exact pinned gomail
// commit, v2.0.0-20160411212932-81ebce5c23df, smtp.go):
//   NewDialer(host, 465, user, pass) → `SSL: port == 465` → implicit TLS
//   with the server cert verified against smtp_host (mail.juneau.love),
//   then EHLO + AUTH PLAIN (Go stdlib smtp.PlainAuth, inline initial
//   response). So this is a plain TLS listener — no STARTTLS to offer.

interface SubmitSession {
  lines: Lines;
  w: WritableStreamDefaultWriter<Uint8Array>;
  authed: boolean;
  rcpts: string[];
}

function constantTimeEq(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

function decodeB64(s: string): string {
  const bin = atob(s.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Quoted-printable: `=XX` escapes, `=CRLF` soft breaks, bare CR stripped. */
function decodeQP(input: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === "=" && i + 2 < input.length) {
      const hex = input.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
      if (input[i + 1] === "\r" && input[i + 2] === "\n") {
        i += 2;
        continue;
      }
    }
    if (c === "\r") continue;
    bytes.push(c.charCodeAt(0) & 0x7f);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function decodePart(body: string, cte: string): string {
  if (cte === "base64") return decodeB64(body);
  if (cte === "quoted-printable") return decodeQP(body);
  return new TextDecoder().decode(new TextEncoder().encode(body));
}

/** RFC 2047 encoded-words (=?charset?B|Q?data?=), incl. adjacent runs. */
function decodeRfc2047(s: string): string {
  return s
    .replace(/\?=(?=\s+=\?)/g, "?=") // whitespace between adjacent encoded words is discarded
    .replace(/=\?([^?\s]+)\?([BbQq])\?([^?]*)\?=/g, (_m, _cs, enc, data) =>
      enc.toUpperCase() === "B" ? decodeB64(data) : decodeQP(data.replace(/_/g, " "))
    );
}

function splitMultipart(body: string, boundary: string): string[] {
  const parts: string[] = [];
  const re = new RegExp(`^--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \t]*(?:\r\n|\n)`, "gm");
  const marks: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) marks.push({ start: m.index, end: m.index + m[0].length });
  for (let i = 0; i < marks.length; i++) {
    const stop = i + 1 < marks.length ? marks[i + 1].start : body.lastIndexOf(`--${boundary}--`);
    if (stop === -1 || stop <= marks[i].end) continue;
    parts.push(body.slice(marks[i].end, stop));
  }
  return parts;
}

/**
 * GoTrue sends no plain-text part (single text/html). Produce one: strip
 * the markup, keep links inline as "text (url)", decode entities. A
 * stripped text part is what umich's gateway sees in the accepted shape;
 * (even text==html has been accepted — 2026-10-24 16:40/19:04 tests.)
 */
function htmlToText(html: string): string {
  let t = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/i, " ")
    .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) =>
      ` ${inner.trim()} (${href}) `)
    .replace(/<\/?(p|div|h[1-6]|li|tr|table|br)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  t = t
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)));
  t = t.replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
  return t;
}

interface ParsedMail {
  subject: string;
  html: string;
  text: string;
}

function parseSubmission(raw: string): ParsedMail | { error: string } {
  const headerEnd = raw.indexOf("\r\n\r\n");
  if (headerEnd === -1) return { error: "no header/body separator" };
  const headers: Record<string, string> = {};
  let lastKey: string | null = null;
  for (const line of raw.slice(0, headerEnd).split("\r\n")) {
    if (line.length === 0) continue;
    if (/^[ \t]/.test(line) && lastKey) {
      headers[lastKey] += ` ${line.trim()}`; // folded header
    } else {
      const idx = line.indexOf(":");
      if (idx > 0) {
        lastKey = line.slice(0, idx).trim().toLowerCase();
        headers[lastKey] = line.slice(idx + 1).trim();
      }
    }
  }
  const body = raw.slice(headerEnd + 4);
  const contentType = headers["content-type"] ?? "";
  const subject = decodeRfc2047(headers["subject"] ?? "").trim();
  if (!subject) return { error: "no subject" };

  let html = "";
  let text = "";
  if (/^multipart\//i.test(contentType)) {
    const bm = /boundary=["']?([^"';\r\n]+)/i.exec(contentType);
    if (!bm) return { error: "multipart without boundary" };
    for (const part of splitMultipart(body, bm[1])) {
      const pe = part.indexOf("\r\n\r\n");
      if (pe === -1) continue;
      const pHeaders = part.slice(0, pe);
      const pBody = part.slice(pe + 4).replace(/\r?\n$/, "");
      const pCT = /content-type:[ \t]*([^;\r\n]+)/i.exec(pHeaders)?.[1]?.trim() ?? "";
      const pCTE = (/content-transfer-encoding:[ \t]*(\w+)/i.exec(pHeaders)?.[1] ?? "7bit").toLowerCase();
      if (pCT.startsWith("text/html")) html = decodePart(pBody, pCTE);
      else if (pCT.startsWith("text/plain")) text = decodePart(pBody, pCTE);
    }
  } else if (contentType.startsWith("text/html")) {
    html = decodePart(body, (headers["content-transfer-encoding"] ?? "7bit").toLowerCase());
  } else if (contentType.startsWith("text/plain")) {
    text = decodePart(body, (headers["content-transfer-encoding"] ?? "7bit").toLowerCase());
    html = text;
  } else {
    return { error: `unsupported content-type: ${contentType}` };
  }
  if (!html) return { error: "no usable body part" };
  if (!text.trim()) text = htmlToText(html) || "juneau.love — please open the HTML version of this message.";
  return { subject, html, text };
}

// Deno's conn.remoteAddr is a null-prototype object ({hostname, port,
// transport} with no toString/valueOf), so interpolating it into a string
// throws "Cannot convert object to primitive value" — which, inside an
// error handler, takes the whole process down (2026-10-25 production
// crash). Always go through this helper when printing addresses.
function addrToString(addr: unknown): string {
  if (typeof addr === "string") return addr;
  const a = addr as { hostname?: string; port?: number } | null;
  if (a && typeof a.hostname === "string" && a.hostname) {
    return typeof a.port === "number" ? `${a.hostname}:${a.port}` : a.hostname;
  }
  return "unknown";
}

// Same failure class: never interpolate a raw unknown into a log line.
function errToString(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message;
  try {
    return JSON.stringify(err) ?? "undefined";
  } catch {
    return "<unprintable error>";
  }
}

async function handleSubmitConn(conn: Deno.Conn): Promise<void> {
  const s: SubmitSession = {
    lines: new Lines(conn.readable),
    w: conn.writable.getWriter(),
    authed: false,
    rcpts: [],
  };
  const reply = async (line: string) => {
    await s.w.write(new TextEncoder().encode(line + "\r\n"));
  };
  try {
    await withTimeout(60_000, async () => {
      await reply("220 mail.juneau.love ESMTP");
      for (;;) {
        const line = await s.lines.next();
        if (line === null) return;
        if (line.length === 0) continue;
        const cmd = line.slice(0, 4).toUpperCase();
        switch (cmd) {
          case "EHLO":
            await reply("250-mail.juneau.love");
            await reply("250-AUTH PLAIN");
            await reply("250 8BITMIME");
            break;
          case "HELO":
            await reply("250 mail.juneau.love");
            break;
          case "NOOP":
            await reply("250 2.0.0 OK");
            break;
          case "RSET":
            s.rcpts = [];
            await reply("250 2.0.0 OK");
            break;
          case "AUTH": {
            if (s.authed) {
              await reply("503 5.5.0 Already authenticated");
              break;
            }
            const rest = line.slice(4).trim();
            if (rest.split(" ")[0]?.toUpperCase() !== "PLAIN") {
              await reply("504 5.5.4 Unrecognized authentication type");
              return; // gomail errors out either way; close
            }
            let token = rest.slice(5).trim();
            if (!token) {
              await reply("334 ");
              token = (await s.lines.next())?.trim() ?? "";
            }
            let ok = false;
            try {
              const parts = decodeB64(token).split("\0");
              ok = parts.length === 3 && parts[1] === SUBMIT_USER && constantTimeEq(parts[2], SUBMIT_PASSWORD);
            } catch {
              ok = false;
            }
            if (!ok) {
              await reply("535 5.7.8 Invalid credentials");
              console.log(`[submit] bad credentials from ${addrToString(conn.remoteAddr)}`);
              return;
            }
            s.authed = true;
            await reply("235 2.7.0 Authentication successful");
            break;
          }
          case "MAIL": {
            if (!s.authed) {
              await reply("503 5.5.0 Authentication required");
              break;
            }
            await reply("250 2.1.0 OK");
            break;
          }
          case "RCPT": {
            if (!s.authed) {
              await reply("503 5.5.0 Authentication required");
              break;
            }
            const addr = /TO:[ \t]*<([^>]*)>/i.exec(line)?.[1]?.trim() ?? "";
            if (addr.length > MAX_ADDRESS_LENGTH || !EMAIL_RE.test(addr)) {
              await reply("501 5.1.3 Bad recipient address");
              break;
            }
            if (s.rcpts.length >= MAX_RECIPIENTS) {
              await reply("452 4.3.2 Too many recipients");
              break;
            }
            if (!s.rcpts.includes(addr)) s.rcpts.push(addr);
            await reply("250 2.1.5 OK");
            break;
          }
          case "DATA": {
            if (!s.authed) {
              await reply("503 5.5.0 Authentication required");
              break;
            }
            if (s.rcpts.length === 0) {
              await reply("503 5.5.0 No valid recipients");
              break;
            }
            await reply("354 End data with <CR><LF>.<CR><LF>");
            const bodyLines: string[] = [];
            let size = 0;
            let tooBig = false;
            let term: "dot" | "eof" | "error" = "dot";
            try {
              for (;;) {
                const l = await s.lines.next();
                if (l === null) { term = "eof"; break; }
                if (l === ".") break;
                const un = l.startsWith("..") ? l.slice(1) : l; // de-dot-stuff
                size += un.length + 2;
                if (size > MAX_BODY_BYTES) tooBig = true;
                bodyLines.push(un);
              }
            } catch (e) {
              // Client hung up mid-DATA: the TLS stream rejects instead of
              // ending cleanly. Treat as early termination, not a crash.
              term = "error";
            }
            // Faithful wire reconstruction: every SMTP DATA line is
            // CRLF-terminated on the wire, so terminate each line. A plain
            // join("\r\n") drops the final CRLF — which is exactly the
            // header/body separator of a bodyless (headers + blank line)
            // message, making it unparseable (2026-10-25 production bug).
            const rawSubmission = bodyLines.map((l) => l + "\r\n").join("");
            void captureSubmission(s.rcpts, rawSubmission, term);
            if (term !== "dot") {
              // Nothing deliverable: GoTrue's net/smtp client vanished
              // before finishing DATA. Log the partial bytes for diagnosis.
              console.error(`[submit] DATA ended before terminator (term=${term}) lines=${bodyLines.length} bytes=${rawSubmission.length} partial=<<${rawSubmission.slice(0, 400).replace(/\r\n/g, "\\n")}>>`);
              try {
                await reply("451 4.3.0 Incomplete data");
              } catch {
                // client already gone
              }
              s.rcpts = [];
              break;
            }
            if (tooBig) {
              await reply("552 5.3.4 Message too large");
              break;
            }
            try {
              const parsed = parseSubmission(rawSubmission);
              if ("error" in parsed) throw new Error(parsed.error);
              await sendMail({ to: s.rcpts, subject: parsed.subject, html: parsed.html, text: parsed.text });
              console.log(`[submit] delivered rcpt=${s.rcpts.join(",")} subject=${JSON.stringify(parsed.subject)}`);
              await reply("250 2.0.0 OK");
            } catch (err) {
              // Transient (recipient gateway 451 etc.) → 451: GoTrue 500s
              // the signup and rolls the user row back, so the guest's
              // retry is a clean fresh attempt.
              console.error(`[submit] delivery to ${s.rcpts.join(",")} failed: ${errToString(err)}`);
              try {
                await reply("451 4.3.0 Temporarily rejected — please try again later");
              } catch {
                // Client already gone; nobody left to tell.
              }
            }
            s.rcpts = [];
            break;
          }
          case "QUIT":
            await reply("221 2.0.0 Bye");
            return;
          default:
            await reply("502 5.5.2 Command not implemented");
        }
      }
    });
  } catch (err) {
    console.error(`[submit] session error (${addrToString(conn.remoteAddr)}): ${errToString(err)}`);
  } finally {
    try {
      conn.close();
    } catch {
      // already closed
    }
  }
}

if (SUBMIT_PASSWORD) {
  try {
    const [submitHost, submitPortStr] = SUBMIT_LISTEN.split(":");
    const cert = await Deno.readTextFile(SUBMIT_CERT);
    const key = await Deno.readTextFile(SUBMIT_KEY);
    const submitListener = Deno.listenTls({
      hostname: submitHost,
      port: Number(submitPortStr ?? "465"),
      cert,
      key,
    });
    console.log(`[submit] GoTrue submission listener on ${SUBMIT_LISTEN} (implicit TLS, AUTH as ${SUBMIT_USER})`);
    for (;;) {
      const conn = await submitListener.accept();
      void handleSubmitConn(conn);
    }
  } catch (err) {
    console.error(`[submit] disabled: ${err}`);
  }
} else {
  console.log("[submit] disabled (SMTP_SUBMIT_PASSWORD not set) — HTTP relay only");
}
