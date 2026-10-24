// Shared helpers for the service-role edge functions.
//
// Runs on the Deno edge runtime (no build step — imports carry explicit
// .ts extensions). The leading underscore keeps the Supabase CLI from
// deploying this directory as a function.

/** Base URL of the Supabase API (injected by the runtime). */
export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://localhost:54321";

/** Service role key (injected by the runtime; never in the client bundle). */
export const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";

/** Anon key (edge function secret; lets functions call PostgREST as any user). */
export const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

/**
 * Base URL of the self-hosted mail relay (edge function secret), e.g.
 * `https://mail.juneau.love`; absent in local dev. The relay (a small Deno
 * service on the mail VPS — infra/mail/) turns the JSON payload into an
 * SMTP hand-off to Maddy, which does the actual internet delivery with
 * SPF/DKIM/DMARC.
 */
export const MAIL_RELAY_URL = Deno.env.get("MAIL_RELAY_URL") ?? "";

/** Shared bearer token for the mail relay (edge function secret). */
export const MAIL_RELAY_TOKEN = Deno.env.get("MAIL_RELAY_TOKEN") ?? "";

/** True when emails are actually delivered (the relay is configured). */
export const MAIL_ENABLED = Boolean(MAIL_RELAY_URL && MAIL_RELAY_TOKEN);

/**
 * Which environment this function instance runs in: "dev" (the local CLI
 * stack) or "prod" (the hosted project). Set `JL_ENV = "dev"` in
 * supabase/config.toml's `[edge_runtime.secrets]` for the local stack; the
 * hosted project leaves it unset. Only the literal value `"dev"` switches
 * to local — unset, `"prod"`, or any other value means prod, so a typo can
 * never silently dev-ify a prod function.
 *
 * JL_ENV selects environment-derived NON-SECRET topology: the site URL
 * (below) and the S3 endpoint/path-prefix/region in s3.ts. Real secrets —
 * the mail relay URL/token and the S3 credentials — are still read from the
 * function env in both environments (dev simply sets no relay, which is
 * the mail dev mode). The topology is deliberately not env-configurable:
 * the hosted project carried a stale `SITE_URL=http://localhost:3000`
 * secret that overrode the prod default and pointed every
 * registration-approval link at the dev machine (2026-10-24 —
 * knowledge/platform/bugs.md). An env-specific non-secret has no business
 * being a secret.
 */
export const JL_ENV: "dev" | "prod" = Deno.env.get("JL_ENV") === "dev" ? "dev" : "prod";

/** The site's origin (login-link redirect target, registration deep links). */
export const SITE_URL = (JL_ENV === "dev" ? "http://localhost:3000" : "https://juneau.love").replace(/\/$/, "");

/** JSON response helper. Status may be a plain number or { status, headers }. */
export function json(
  body: unknown,
  statusOrOptions: number | { status?: number; headers?: Record<string, string> } = 200,
): Response {
  const status = typeof statusOrOptions === "number" ? statusOrOptions : (statusOrOptions.status ?? 200);
  const extraHeaders = typeof statusOrOptions === "number" ? undefined : statusOrOptions.headers;
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

/**
 * CORS for browser calls (the site's origin → the function URL). The
 * hosted edge runtime does NOT answer CORS preflights itself: it forwards
 * OPTIONS to the function, which must return the allow-headers itself.
 * Without this, the browser blocks every JSON POST from the site (observed
 * 2026-10-22: the preflight was answered 405, the function body never ran,
 * and sign-in was dead on the hosted project while curl-based tests — no
 * preflight — passed). Answers OPTIONS with 204 and stamps
 * Access-Control-Allow-Origin (echoing the caller's origin; the
 * functions' own auth, not CORS, is the security boundary) on every
 * response.
 */
export function withCors(
  handler: (req: Request) => Response | Promise<Response>,
): (req: Request) => Promise<Response> {
  return (req) => {
    const origin = req.headers.get("origin");
    const allowOrigin = origin && origin !== "*" ? origin : "*";
    if (req.method === "OPTIONS") {
      return Promise.resolve(
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": allowOrigin,
            "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
            "access-control-allow-methods": "POST, OPTIONS",
            "access-control-max-age": "86400",
            "vary": "origin",
          },
        }),
      );
    }
    return Promise.resolve(handler(req)).then((res) => {
      res.headers.set("access-control-allow-origin", allowOrigin);
      res.headers.set("vary", "origin");
      return res;
    });
  };
}

/**
 * PostgREST call with the service role key. Returns the parsed body (or
 * null when there is none — e.g. a 204) plus the HTTP status.
 */
export async function rest(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

/**
 * Ask GoTrue (admin API, service role) for a fresh magiclink for `email`.
 * The exact call verified by supabase/tests/flows.sh:
 * POST /auth/v1/admin/generate_link { email, type: "magiclink", redirect_to }.
 */
export async function generateMagicLink(
  email: string,
  redirectTo: string,
): Promise<{ ok: true; action_link: string } | { ok: false; error: string }> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, type: "magiclink", redirect_to: redirectTo }),
  });
  const data: Record<string, unknown> = await res.json().catch(() => ({}));
  const action_link = typeof data.action_link === "string" ? data.action_link : "";
  if (!res.ok || !action_link) {
    const msg = typeof data.error_description === "string" ? data.error_description
      : typeof data.msg === "string" ? data.msg
      : `GoTrue generate_link failed (HTTP ${res.status})`;
    return { ok: false, error: msg };
  }
  return { ok: true, action_link };
}

/**
 * Send one email through the self-hosted mail relay (to one or more
 * recipients). Edge functions can't open raw TCP (the edge runtime denies
 * Deno.connect), so the relay — which speaks SMTP to Maddy on the VPS — is
 * the only mail path out of Supabase; design notes in
 * knowledge/platform/mail.md.
 *
 * The From address is fixed on the relay (RELAY_FROM), not per call.
 * Returns false (and logs) on any failure, including a missing
 * MAIL_RELAY_URL/MAIL_RELAY_TOKEN — the caller decides how to treat that
 * (send-login-link and notify-registration treat a missing config as dev
 * mode; registration-decision reports email_sent: false).
 */
export async function sendEmail(
  to: string | string[],
  subject: string,
  html: string,
  text: string,
): Promise<boolean> {
  if (!MAIL_RELAY_URL || !MAIL_RELAY_TOKEN) {
    console.log("[email] mail relay not configured — skipping send (local dev)");
    return false;
  }
  const res = await fetch(`${MAIL_RELAY_URL.replace(/\/$/, "")}/send`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${MAIL_RELAY_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ to: Array.isArray(to) ? to : [to], subject, html, text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[email] mail relay rejected the email (HTTP ${res.status}): ${body}`);
    return false;
  }
  return true;
}

/** Decode the `sub` claim of a bearer token (the runtime verified it). */
export function jwtSub(authorization: string | null): string | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  const parts = authorization.slice("Bearer ".length).split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    // atob() returns a string (the JWT payload is ASCII JSON).
    const payload = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))) as { sub?: unknown };
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * PostgREST call as the calling user (anon apikey + the user's verified JWT)
 * so RLS applies on their behalf. Used by the asset functions to look up
 * rows the user may actually see — the security boundary is the policy,
 * not the code. Returns null data on a network-level failure (res null).
 */
export async function restAsUser(
  path: string,
  userJwt: string,
): Promise<{ status: number; data: unknown } | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON_KEY, authorization: `Bearer ${userJwt}` },
  }).catch(() => null);
  if (!res) return null;
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

/** Escape user-controlled text for interpolation into the email HTML. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Guest-facing login-link email: a heading, an intro line, and the
 * magiclink button. Used by send-login-link and registration-decision
 * (different heading/intro).
 */
export function loginLinkEmail(name: string, intro: string, link: string):
  { subject: string; html: string; text: string } {
  const subject = "Your juneau.love login link";
  const footer =
    "This link is single-use and expires after about an hour. " +
    "If you didn’t ask for it, you can safely ignore this email.";
  const html = `<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#faf7f6;">
  <div style="max-width:480px;margin:0 auto;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <p style="font-size:18px;color:#5c4048;margin:0 0 8px;">juneau.love</p>
    <h1 style="font-size:20px;color:#1a1a1a;font-weight:600;margin:0 0 12px;">${name ? `Hi ${name}, ` : ""}${intro}</h1>
    <p style="margin:24px 0;">
      <a href="${link}" style="display:inline-block;background:#b76e79;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:15px;">Sign in</a>
    </p>
    <p style="color:#777;font-size:13px;line-height:1.6;">${footer}</p>
  </div>
</body>
</html>`;
  const text = `${name ? `Hi ${name}, ` : ""}${intro}\n\nSign in: ${link}\n\n${footer}`;
  return { subject, html, text };
}

/**
 * The admin "new registration" alert (notify-registration): the guest's
 * details plus approve/reject deep links into the registrations page.
 * The links are plain UX — the decision itself goes through
 * registration-decision with the admin's own session, so no link carries
 * any privilege. `approved` rows are never alerted about; see the concept
 * doc for the idempotency stamp.
 */
export function registrationAlertEmail(opts: {
  name: string;
  email: string;
  registeredAt: string;
  confirmed: boolean;
  approveUrl: string;
  rejectUrl: string;
  listUrl: string;
}): { subject: string; html: string; text: string } {
  const { name, email, registeredAt, confirmed, approveUrl, rejectUrl, listUrl } = opts;
  const subject = `New registration: ${name} (${email})`;
  const when = new Date(registeredAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const confirmNote = confirmed
    ? "Their email is confirmed — you can approve right away."
    : "Their email isn’t confirmed yet — approving unlocks once they confirm it (you can reject in the meantime).";
  const signInNote =
    "You’ll need to be signed in as an admin for the buttons to work. " +
    "If you didn’t expect this, the registrations page shows who registered with what address.";
  const html = `<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#faf7f6;">
  <div style="max-width:480px;margin:0 auto;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <p style="font-size:18px;color:#5c4048;margin:0 0 8px;">juneau.love</p>
    <h1 style="font-size:20px;color:#1a1a1a;font-weight:600;margin:0 0 12px;">New registration: ${esc(name)}</h1>
    <table style="font-size:15px;color:#333;border-collapse:collapse;margin:0 0 4px;">
      <tr><td style="padding:2px 16px 2px 0;color:#777;">Name</td><td style="font-weight:600;">${esc(name)}</td></tr>
      <tr><td style="padding:2px 16px 2px 0;color:#777;">Email</td><td>${esc(email)}</td></tr>
      <tr><td style="padding:2px 16px 2px 0;color:#777;">Registered</td><td>${when}</td></tr>
      <tr><td style="padding:2px 16px 2px 0;color:#777;">Email confirmed</td><td>${confirmed ? "yes" : "not yet"}</td></tr>
    </table>
    <p style="color:#555;font-size:14px;line-height:1.6;margin:16px 0;">${confirmNote} ${signInNote}</p>
    <p style="margin:24px 0;">
      <a href="${approveUrl}" style="display:inline-block;background:#b76e79;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:15px;margin-right:8px;">Approve</a>
      <a href="${rejectUrl}" style="display:inline-block;background:#ffffff;color:#5c4048;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:15px;border:1px solid #d9b8be;">Reject</a>
    </p>
    <p style="color:#777;font-size:13px;line-height:1.6;"><a href="${listUrl}" style="color:#b76e79;">View all registrations</a></p>
  </div>
</body>
</html>`;
  const text =
    `New registration: ${name}\n\n` +
    `Name: ${name}\nEmail: ${email}\nRegistered: ${when}\nEmail confirmed: ${confirmed ? "yes" : "not yet"}\n\n` +
    `${confirmNote} ${signInNote}\n\n` +
    `Approve: ${approveUrl}\nReject: ${rejectUrl}\nAll registrations: ${listUrl}`;
  return { subject, html, text };
}
