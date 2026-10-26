---
type: edge-function
title: email-template (GoTrue template source)
description: Publicly invokable edge function that serves the raw GoTrue confirmation email template; the GoTrue project setting mailer_templates_confirmation_content points at it.
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-26T03:40:00Z }
verified: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-26T03:12:41Z }
---

# email-template

Serves the **raw, unrendered** Go `html/template` document that GoTrue
uses for signup confirmation emails. GoTrue's project setting
`mailer_templates_confirmation_content` points at
`https://<project-ref>.supabase.co/functions/v1/email-template`
(deployed 2026-10-26 with `--no-verify-jwt`).

## Why it exists

The hosted GoTrue's template-URL fetch is broken: its "fetch" returns a
fabricated HTTP 200 whose body is either the URL string itself or empty,
and the request **never reaches the target host** (verified
host-independently, 2026-10-26 — see the fabricated-egress entry in
[Bug list](../platform/bugs.md)). So the template has to live where
(1) the relay's `resolveTemplateUrl` rescue can fetch it when GoTrue
submits the URL string as the body, and (2) fetches from Supabase's own
edge work. This function is that point: public, on the project origin,
with live-fetch + embedded fallback.

## Contract

```
GET /functions/v1/email-template          (publicly invokable — no JWT)
```

No parameters. Response: `text/html; charset=utf-8`, the raw template
(source of truth: `static/email/confirmation.html` in the repo).

## Behavior

1. Live-fetch `https://mail.juneau.love/gotrue/confirmation.html`
   (the VPS staging copy of `static/email/confirmation.html`, served by
   nginx with fetches logged to
   `/var/log/nginx/gotrue-template-fetches.log` — the observability
   point that exposed the fabricated egress).
2. Any failure (fetch error, non-2xx, < 1 kB) falls back to an
   embedded copy of the template in the function source.
3. Logs to the function log which source it served.

## Invariants

- The served document is a **Go template**, not a rendered page:
  `{{ .Email }}`, `{{ if .Data.display_name }}`, `{{ .ConfirmationURL }}`
  stay literal. (Template variable list: [Mail (self-hosted
  Maddy)](../platform/mail.md), Email templates.)
- The HTML comments must not contain `{{ }}` — actions inside comments
  break GoTrue's `html/template` parse.
- The function never renders anything itself; GoTrue renders at send
  time. The only consumers are GoTrue's broken fetch (fabricated — it
  never actually sees this response) and the relay's resolver (which
  rescues mode-1 sends by fetching this URL).
- **To rebrand**: edit `static/email/confirmation.html` → copy to the
  VPS staging path (immediate, used by the live fetch) and update the
  embedded fallback in `supabase/functions/email-template/index.ts` →
  redeploy (`~/.local/bin/supabase functions deploy email-template
  --no-verify-jwt`). GoTrue caches template fetches ~10 min, so
  rebrands take effect within ~10 min, no restart.
- `mailer_templates_magic_link_content` is intentionally **not**
  pointed here (stays empty / built-in default) — the magiclink path is
  only the register page's "already registered" probe.

## Deploy notes

Functions deploy as eszip bundles via the CLI's Docker bundler — the
Management API rejects raw zips, so the CLI is required (restored
2026-10-26 at `~/.local/bin/supabase`, v2.121.0; the binary had gone
missing, leaving only the `~/.supabase/cli-latest` version marker).
