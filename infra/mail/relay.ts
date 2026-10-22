// relay — HTTP -> SMTP relay for juneau.love's Supabase edge functions.
//
// The edge functions cannot open raw TCP (the edge runtime denies
// Deno.connect — its user worker's net permission scope is empty), so every
// email the site sends goes:
//
//   edge function --HTTPS--> Caddy (mail.juneau.love)
//              --loopback--> this relay --SMTP--> Maddy (127.0.0.1:25)
//              --direct MX delivery--> internet
//
// Maddy signs with DKIM; SPF/DMARC come from DNS (see README.md here and
// knowledge/platform/mail.md in the repo). GoTrue's own auth emails do NOT
// use this relay — they connect to Maddy's :587 submission port directly
// (Supabase custom SMTP).
//
// Zero dependencies. Run with plain Deno:
//
//   deno run --allow-net --allow-env relay.ts
//
// Env (see /etc/mail-relay/env on the VPS):
//   RELAY_LISTEN   default 127.0.0.1:8080  (loopback only — Caddy fronts it)
//   RELAY_SMTP     default 127.0.0.1:25    (Maddy's loopback handoff)
//   RELAY_HELO     default mail.juneau.love
//   RELAY_FROM     default "juneau.love <notify@juneau.love>"
//   MAIL_RELAY_TOKEN  required — the shared bearer token the functions send
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
