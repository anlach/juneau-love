---
type: project-notes
title: Bug list
description: Running log of real bugs found in the hosted Supabase project, the mail stack, and the site — with root cause, fix, and status. Newest first.
generated: { by: pi, at: 2026-10-24T06:25:00Z }
---

# Bug list

Statuses: **OPEN** (needs a fix), **FIXED** (shipped/verified), **WATCH**
(known limitation, accepted or mitigated). Newest first. Mail-stack details
live in [Mail](/mail.md); this list is the cross-cutting defect log.

## OPEN

### Function mail secrets were never set on the hosted project (2026-10-24)
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
- Fix: set both secrets on the project (CLI `supabase secrets set`).
  **Code follow-up:** dev mode should not write the stamps, and the FE could
  surface the dev-mode link instead of pretending it was mailed.

### `notify-registration` dev-mode send poisons the idempotency stamp (2026-10-24)
Sub-case of the above, called out because the data repair is separate: the
23:03 guest registration (`lacharit@umich.edu`) alerted admins only to the
function log and stamped `admin_notified_at`, so no real approval email will
ever fire for that registration.
- Data repair (owner console): `update public.users set admin_notified_at
  = null where email = 'lacharit@umich.edu';` then re-call the function (or
  let the guest's next page load trigger the fallback).
- Code fix: skip the stamp when `MAIL_ENABLED` is false.

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
