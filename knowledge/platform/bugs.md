---
type: project-notes
title: Bug list
description: Running log of real bugs found in the hosted Supabase project, the mail stack, and the site — with root cause, fix, and status. Newest first.
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-24T16:05:00Z }
---

# Bug list

Statuses: **OPEN** (needs a fix), **FIXED** (shipped/verified), **WATCH**
(known limitation, accepted or mitigated). Newest first. Mail-stack details
live in [Mail](/mail.md); this list is the cross-cutting defect log.

## OPEN

### Env-specific topology smuggled in as function secrets (`SITE_URL` → localhost, S3 env) (2026-10-24)
The 2026-10-24 06:23Z secret batch copied local-stack values into the
hosted project. `SITE_URL` held `http://localhost:3000` (the code default
was already `https://juneau.love` — the secret overrides it), so every
derived link pointed at the dev machine: the registration-approval deep
links (`?approve=<id>` / `?reject=<id>` and the list link in the
`notify-registration` alert) and the magic-link redirect target in
`send-login-link` / `registration-decision`
(`generateMagicLink(email, ${SITE_URL}/login)`). Observed: the approval
links in the first real admin alert opened localhost and were unusable.
The same batch also set `S3_ENDPOINT` / `S3_PATH_PREFIX` / `S3_REGION` —
keys that exist only in the local `config.toml` — and re-stamped
`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` (secret values are unreadable;
if those hold the local CLI defaults, hosted presigned asset URLs point at
`http://127.0.0.1:54321` with the wrong keys). The Hippius keys in the dev
shell are live-verified (2026-10-24, `supabase/tests/s3-presign.ts`
round-trip) and available for re-setting if needed.
- Root cause: environment-derived **non-secret** topology (site URL,
  local-stack S3 settings) was overridable per environment via function
  secrets, so a stale local write silently wins over the prod code default.
- Fix (code, 2026-10-24): a `JL_ENV` function env (`dev` | `prod`; unset
  or any non-`dev` value = prod) selects the topology in `_shared` —
  `SITE_URL`, the S3 endpoint/path-prefix/region, and the dev S3
  credentials are now per-environment constants; only real secrets (mail
  relay, prod S3 credentials) stay in the function env. Local:
  `config.toml` `[edge_runtime.secrets]` carries just `JL_ENV = "dev"`.
- Fix (deploy, pending): unset the topology secrets on the hosted project
  (`SITE_URL`, `S3_ENDPOINT`, `S3_PATH_PREFIX`, `S3_REGION`, `S3_BUCKET`)
  and redeploy all five functions (all import `_shared`).
- Verify: a fresh admin alert / approval email whose links open
  `https://juneau.love`; hosted gallery image URLs pointing at
  `s3.hippius.com` (if they point at 127.0.0.1, the S3 credential secrets
  are the local defaults — re-set the Hippius keys).
- Follow-up (owner request, still open): sweep the whole app for
  dev/local values that leaked into prod — code defaults, email templates,
  DNS (function secrets are covered above).

### Supabase Management API silently drops `smtp_pass` writes (2026-10-23)
`PATCH /v1/projects/{ref}/config/auth` returns HTTP 200 with
`smtp_pass` in the body, but read-back shows the old value; every other
field in the same PATCH applies. Consequence: the config store still holds
the retired Maddy password while the running GoTrue and Maddy agree on the
current one — a future GoTrue re-provision (new region, stack redeploy)
would break auth mail again.
- Workaround: set the SMTP password in the dashboard UI (or re-hash Maddy
  to whatever the store holds — the 2026-10-23 incident used this in
  reverse). Candidate for a Supabase support ticket.

## FIXED

### Registration confirmation email is unbranded (2026-10-24)
A guest's first email is GoTrue's default confirmation template — plain
and unstyled — while the site's own emails (login link, registration
alert) are branded with a proper button. The register page's
"already registered" probe emails the returning guest GoTrue's own
magiclink email — unbranded the same way.
- Root cause: in GoTrue (v2.197.0, latest tag) the template content
  setting (`mailer_templates_*_content`) is a **URL** the running GoTrue
  GETs (relative = against `SiteURL`), parsed with Go's `html/template`,
  cached 10 minutes — not inline HTML. The project held the default
  template's inline HTML in the setting; that is a malformed URL, so the
  fetch failed and GoTrue **silently fell back to the built-in default**.
  The stored "template" was dead config that could never apply, and the
  fallback never errors.
- Fix: the branded templates are static pages on the site —
  `static/email/confirmation.html` and `static/email/magic-link.html`
  (same design as the edge-function emails in `supabase/functions/_shared`)
  — and the project settings point at them: `mailer_templates_confirmation_content`
  = `https://juneau.love/email/confirmation.html`,
  `mailer_templates_magic_link_content` =
  `https://juneau.love/email/magic-link.html`, with subjects
  `mailer_subjects_confirmation` = "Confirm your juneau.love email" and
  `mailer_subjects_magic_link` = "Your juneau.love sign-in link". Applied
  via the Management API, read-back verified.
- Verified (2026-10-24): both templates parse and render under Go's
  `html/template` with the real variable set (including nil / absent
  `Data.display_name`); the Management API read-back matches. Final check:
  a real test signup → branded confirmation email in the inbox (owner —
  the only check that can't be run without a real mailbox). The silent
  fallback means a broken template URL never breaks auth, only the
  branding — so a future redesign must verify with a send, not by
  reading the config back.
- Mechanism details: [Mail](/mail.md), Email templates.

### Function mail secrets missing on the hosted project (2026-10-24)
`send-login-link` and `notify-registration` ran in **dev mode** on the
hosted project: with `MAIL_RELAY_URL`/`MAIL_RELAY_TOKEN` absent, they print
the email to the function log and return `sent: true`. The sign-in page then
claims the link was sent; nothing leaves the building. Worse, dev-mode
"sends" still write their stamps (`users.last_login_link_sent_at` cooldown,
`users.admin_notified_at` idempotency), so the 10-minute cooldown and the
once-per-registration admin alert were silently consumed by log-only sends.
- Symptom: "email said sent, never received"; admin approval alert missing;
  user clicks a stale inbox link → "That link has already been used or has
  expired" (accurate — no fresh link was ever generated-and-sent).
- Fix: set both secrets on the project (CLI `supabase secrets set`),
  06:23 UTC 2026-10-24; first real relay delivery verified 06:25:55 and
  admin sign-in via the site confirmed working.

### DKIM TXT published corrupt → umich 451 "denied by local policy" (2026-10-24)
The published `mail._domainkey.juneau.love` contained stray spaces inside
the base64 (chunking error at publish time), so the `p=` value did not match
Maddy's key and DKIM verification was impossible. Gmail didn't care (SPF
aligned after the PTR fix); UMich's Mimecast gateway rejected with 451.
Re-published the exact on-disk `.dns` value; byte-for-byte match verified,
and umich accepted the next confirmation (06:09, no 451).
Lesson: after publishing a DKIM record, compare the reassembled TXT to the
key file, don't trust the panel's echo.

### Missing PTR on the VPS (2026-10-23)
`66.42.121.163` reversed to the Choopa default. Host asked for and set
PTR = `mail.juneau.love`; forward/reverse loop verified. Prerequisite for
SPF alignment with strict receivers.

### `rate_limit_email_sent` = 2 (2026-10-23)
Supabase had a 2-emails/hour cap; repeated sign-in attempts silently 429'd.
Raised to 30 (GoTrue's default).

### Running GoTrue held stale SMTP credentials (2026-10-23)
The running GoTrue process kept an old Maddy password after the Supabase
SMTP config changed (config edits do not re-provision a running GoTrue).
Maddy rejected it (`bcrypt: hashedPassword is not the hash`); GoTrue still
returned HTTP 200 to the client, so every auth email "sent" silently
failed. Fixed by re-hashing the VPS `pass_table` entry to the password the
running GoTrue presents (captured with `infra/mail/smtp-capture-tls.py`),
restarting Maddy, and verifying end-to-end delivery. See
[Mail](/mail.md) for the capture runbook.
