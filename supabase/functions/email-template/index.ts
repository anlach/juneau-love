// email-template — serves the GoTrue signup-confirmation email template.
//
//   GET /functions/v1/email-template   (public — GoTrue's template fetcher
//   sends no auth; deploy with --no-verify-jwt)
//
// Why this exists (2026-10-26): GoTrue's hosted template fetcher has a
// broken egress path for EXTERNAL template URLs — the GET never reaches
// the host (our nginx sees no request) and the response comes back
// fabricated: either the URL string itself as a 200 body, or an empty
// body (knowledge/platform/bugs.md). Pointing
// mailer_templates_confirmation_content at this function keeps the fetch
// on Supabase's own project origin (internal routing), sidestepping the
// broken egress entirely.
//
// The template is fetched live from the mail VPS (single source of truth,
// editable without a redeploy, and every fetch lands in the VPS nginx
// log at /var/log/nginx/gotrue-template-fetches.log). If the VPS is
// unreachable, an embedded copy is served instead.
//
// The document is a Go html/template: the {{ .ConfirmationURL }} /
// {{ .Email }} / {{ .Data.display_name }} actions are rendered by GoTrue
// — this function must serve them verbatim, unrendered.
//
// Design: knowledge/platform/mail.md ("Email templates"),
// knowledge/platform/bugs.md (template fetch modes 1/2).

import { withCors } from "../_shared/index.ts";

const TEMPLATE_URL = "https://mail.juneau.love/gotrue/confirmation.html";
const FETCH_TIMEOUT_MS = 5_000;
const MAX_BYTES = 1_000_000;

// Fallback: embedded copy of static/email/confirmation.html. Kept in sync
// manually; the live VPS fetch is the source of truth.
const FALLBACK = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Confirm your email address — juneau.love</title>
</head>
<body style="margin:0;padding:24px;background:#faf7f6;">
  <div style="max-width:480px;margin:0 auto;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <p style="font-size:18px;color:#5c4048;margin:0 0 8px;">juneau.love</p>
    <h1 style="font-size:20px;color:#1a1a1a;font-weight:600;margin:0 0 12px;">{{ with .Data }}{{ with .display_name }}Hi {{ . }}, {{ end }}{{ end }}Confirm your email address</h1>
    <p style="color:#555;font-size:15px;line-height:1.6;margin:0 0 8px;">You registered on juneau.love with {{ .Email }}. Click the button below to confirm this address.</p>
    <p style="color:#555;font-size:15px;line-height:1.6;margin:0;">Once confirmed, we’ll review your registration and email you a sign-in link.</p>
    <p style="margin:24px 0;">
      <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#b76e79;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:15px;">Confirm my email address</a>
    </p>
    <p style="color:#777;font-size:13px;line-height:1.6;">If you didn’t register on juneau.love, you can safely ignore this email.</p>
  </div>
</body>
</html>
`;

function withTimeout<T>(ms: number, p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

Deno.serve(
  withCors(async (req) => {
    if (req.method !== "GET") {
      return new Response("method not allowed", { status: 405 });
    }
    // Observable in the function logs (dashboard → Logs): every template
    // fetch by GoTrue lands here.
    console.log(`[email-template] template fetch from ${req.headers.get("user-agent") ?? "?"}`);
    try {
      const res = await withTimeout(FETCH_TIMEOUT_MS, fetch(TEMPLATE_URL));
      if (res.ok) {
        const text = await res.text();
        if (text.trim() && text.length <= MAX_BYTES) {
          return new Response(text, {
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
        console.warn(`[email-template] VPS template unusable (${text.length} bytes); using embedded fallback`);
      } else {
        console.warn(`[email-template] VPS template fetch HTTP ${res.status}; using embedded fallback`);
      }
    } catch (err) {
      console.warn(`[email-template] VPS template fetch failed: ${err instanceof Error ? err.message : err}; using embedded fallback`);
    }
    return new Response(FALLBACK, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }),
);
