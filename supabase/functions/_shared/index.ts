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

/** Resend API key (edge function secret); absent in local dev. */
export const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";

/** The site's origin (login links redirect here). Secret for prod override. */
export const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://juneau.love").replace(/\/$/, "");

/** JSON response helper. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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
 * Send one email through Resend. Returns false (and logs) on any failure,
 * including a missing RESEND_API_KEY — the caller decides how to treat
 * that (send-login-link treats a missing key as dev mode;
 * registration-decision reports email_sent: false).
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.log("[email] RESEND_API_KEY not set — skipping send (local dev)");
    return false;
  }
  const from = Deno.env.get("EMAIL_FROM") ?? "juneau.love <notify@juneau.love>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[email] Resend rejected the email (HTTP ${res.status}): ${body}`);
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
 * The one email shape the site sends: a heading, an intro line, and the
 * magiclink button. Both auth functions use it (different heading/intro).
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
