---
type: project-notes
title: Bug list
description: Running log of real bugs found in the hosted Supabase project, the mail stack, and the site — with root cause, fix, and status. Newest first.
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-24T17:12:00Z }
---

# Bug list

Statuses: **OPEN** (needs a fix), **FIXED** (shipped/verified), **WATCH**
(known limitation, accepted or mitigated). Newest first. Mail-stack details
live in [Mail](/mail.md); this list is the cross-cutting defect log.

**Static-hosting note (verified 2026-10-26):** the site is adapter-static
with `fallback: '404.html'`, and every `ssr = false` route (register,
login, verify, auth/confirm, …) is not prerendered — so **direct
deeplink loads of those paths return HTTP 404** while in-app client
navigation works. The 404.html served is a full SvelteKit app-boot
shell, so in a real browser the SPA boots and the client router renders
the target route (that's how the `/verify` email hop works). Curl/bots
see 404s on those paths — expected, not a bug.

## OPEN

### Hosted GoTrue's template fetch never reaches the target host (2026-10-26)
GoTrue's fetch of a configured `mailer_templates_*_content` URL returns a
**fabricated HTTP 200** whose body is either the URL string itself or
empty — the request never reaches the target, for VPS-hosted or
supabase.co-hosted URLs alike (2026-10-26 controlled experiment: no
request from any Supabase IP in the target's access log, while
edge-function egress from the same project logged normally minutes apart).
Because the response is a 200, GoTrue's "fall back to the built-in
default on fetch failure" never fires: a URL-valued setting produces a
degenerate send at random — the guest receives an email whose entire
body is the URL string, or a bodyless message (→ relay `451` → signup
rolled back).
- **Rule: never put a URL in a `mailer_templates_*_content` setting** —
  inline the raw template document. The confirmation template is inlined
  today; see [Mail](/mail.md), Email templates.
- Empty-string writes to the store also do not reliably propagate to the
  running GoTrue (non-empty writes propagate <60 s).
- Candidate for a Supabase support ticket.
- Side note: function deploys require the Supabase CLI (eszip bundles via
  the podman bundler; the Management API rejects raw zips).

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

### UMich 451 tempfails — degenerate template bodies, not shape or IP (2026-10-23 → 2026-10-26)
umich.edu's Mimecast gateway (`mx1/mx2.a.mail.umich.edu`) temp-failed
outbound mail with 451 "denied by local policy" in drifting windows; on
2026-10-26 02:22–03:26 UTC every umich-bound send 451'd, which 500'd real
registration attempts (clean rollback — "Registration didn't go
through").
- **Final root-cause guess (2026-10-26 bisection; full evidence in
  `UMICH-451-DEBUG.md` in the repo root):** the 451s tracked the
  *body*. Every 451'd send of the morning carried a degenerate body
  produced by the fabricated template fetch (OPEN entry above) — a bare
  template-URL string, an empty body, or, via the relay's then-live
  rescue, the raw **unrendered** Go template with literal `{{ }}`.
  Every bisection send carrying a fully rendered template was accepted,
  including `:587`-direct controls from the same IP and both message
  shapes. Message shape (single-part vs multipart, Message-ID domain)
  and the sending IP (Spamhaus PBL-listed Choopa range; DBBL/UCE clean)
  are exonerated. Caveat: umich's accept/reject windows drift day to
  day, so body content is a strong association, not a proven single
  cause.
- **Fix:** the confirmation template is inlined in GoTrue's store config
  (the raw document, byte-identical to `static/email/confirmation.html`)
  — GoTrue renders natively, no fetch, so degenerate bodies can no longer
  occur. Since the fix: every send accepted — 5/5 umich-bound
  test/control sends plus the first real registration (15:06 UTC
  2026-10-26, delivered to proton.me).
- **Cleaned up afterwards:** the relay's `resolveTemplateUrl` rescue (it
  shipped raw `{{ }}` bodies — exactly what umich rejected), the
  `email-template` edge function, and the VPS template staging + nginx
  location. The relay's `:465` shim stays: it is the proven production
  path and hosts the submission capture; GoTrue's native shape was never
  cleared by umich.
- **Residual:** umich can still tempfail in a bad window; the register
  page's 4× retry (10/30/60 s) is the backstop. If 451s recur on
  *rendered* bodies, that's a hosting/IP problem, not a mail-stack one —
  options: wait out the window, move mail to a clean datacenter IP (the
  `infra/mail/` runbook is portable), or a transactional provider for
  auth mail.
- The 2026-10-25 "email delivered as a link to the template file" and
  "bodyless email" incidents were earlier instances of the same
  fabricated fetch (details in the git history on `relay-submit-crash`).

### Maddy `:587` open relay — unauthenticated external spam submitted + relayed (2026-10-23 → 10-25)
Maddy's public `:587` listener was a plain `smtp` endpoint (AUTH
optional): any internet client could submit external mail and Maddy
relayed it. 20 external submissions from spoofed senders to
hotmail/yahoo/aol/gmail were accepted 2026-10-23 → 10-24 21:11, several
delivered; the recipient-gateway rejections in that window name the VPS
IP explicitly. Fixed 2026-10-25 21:51: endpoint renamed `smtp` →
`submission` in `/etc/maddy/maddy.conf` (backup
`/root/maddy.conf.bak-20261025`), verified from outside (unauthenticated
`MAIL FROM` → `502 5.7.0 Please authenticate first`). The Oct 23–24 spam
window is what associated the IP with spam; the 2026-10-26 bisection
exonerated the IP as the 451 cause (entry above).

### Mail relay process crashed on any submit-session error (2026-10-25)
The relay's `:465` GoTrue submission handler took the whole process down
(HTTP relay + every edge-function mail send) whenever a session errored —
observed in production 2026-10-25 02:49:32 UTC, in the middle of
registration attempts.
- Root cause: in Deno 2.9.7 `conn.remoteAddr` is a **null-prototype
  object** (no `toString`/`valueOf`), so `${conn.remoteAddr}` in the
  error path threw *while handling the original error* → unhandled
  rejection → process exit. A single `AUTH PLAIN` with wrong credentials
  (an internet scanner) killed the mail path. Secondary: the inner catch's
  `451` reply write to a vanished client was unguarded and hit the same
  landmine.
- Fix: `addrToString()` (never interpolates the raw object) for address
  logging, `errToString()` for error values, and the `451` reply write is
  guarded. Repro/regression: `infra/mail/test_relay_submit.py` (pre-fix
  the bad-AUTH session kills the process with the exact production stack
  trace; post-fix all checks pass including post-trigger recovery).

### Email action links had no site route to land on (2026-10-25)
GoTrue's action links carry `redirect_to=https://juneau.love/auth/
confirm`, and a SiteURL-anchored link would have pointed at
`https://juneau.love/verify` — a route the static site didn't have
(deep links to `ssr = false` routes 404 at the HTTP level — the
static-hosting note above). The production link observed 2026-10-26
points directly at the hosted GoTrue verify endpoint
(`https://<ref>.supabase.co/auth/v1/verify`) and 303s to
`redirect_to` with the session in the fragment; the client-only
`/verify` route (`src/routes/verify/`, probe-verified 2026-10-26) is the
hop for SiteURL-anchored links — it passes the query string through to
the same endpoint. Flow: [Client authentication](../api/client-auth.md).

### Orphaned `auth.users` row deadlocked register/sign-in (2026-10-25)
Manual cleanup during the 2026-10-24 UMich debugging deleted the test
`lacharit@umich.edu` guest's `public.users` row but left its
`auth.users` row (created 2026-10-24 06:09 by the accepted signup,
never email-confirmed). The register probe (`signInWithOtp` with
`shouldCreateUser: false`) asks **GoTrue** (`auth.users`) → "An account
with that email already exists — sign in"; `send-login-link` asks
**`public.users`** via REST → `not_found` → "That email isn’t registered
yet". Both messages are true at the same time — a deadlock with no
UI path out of it.
- Root cause: the half-delete. The `auth.users → public.users` cascade
only runs when the auth row is removed; deleting the profile row alone
orphans the auth account. The `on_auth_user_created` trigger keeps the
pair together at signup, but nothing reconciles a later manual delete.
- Fix: delete the orphaned `auth.users` row (Management API
`DELETE /v1/projects/{ref}/auth/users/{id}`, or SQL
`delete from auth.users where id = '…'`), then re-run registration
fresh (which also became the first production test of the `:465` shim).
- Lesson: to manually remove a guest, delete the **auth** row (the
cascade cleans up the profile) — never the profile row alone.

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
`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` (secret values unreadable).
- Root cause: environment-derived **non-secret** topology (site URL,
  local-stack S3 settings) was overridable per environment via function
  secrets, so a stale local write silently wins over the prod code default.
- Fix (code, 2026-10-24, commit 3dc6722): a `JL_ENV` function env
  (`dev` | `prod`; unset or any non-`dev` value = prod) selects the
  topology in `_shared` — `SITE_URL` and the S3 endpoint/path-prefix/
  region are per-environment constants the stale secrets can no longer
  touch; only real secrets (mail relay, S3 credentials, bucket name) stay
  in the function env. Local: `config.toml` `[edge_runtime.secrets]`
  carries just `JL_ENV = "dev"`.
- Fix (deploy): all five functions redeployed 2026-10-24 14:34 UTC
  (Management API `updated_at`), 19 min after the code commit — hosted
  code is the fixed version, so the `SITE_URL`/`S3_ENDPOINT`/
  `S3_PATH_PREFIX`/`S3_REGION` secrets are inert dead weight if never
  unset.
- Residual (cleanup only): unset the stale topology secrets on the hosted
  project. `S3_BUCKET` is still read from env, but its local value equals
  the prod default (`juneau-assets`).
- Verify: a fresh admin alert / approval email whose links open
  `https://juneau.love` (the 2026-10-24 registration retest covers this).
  Separate live risk from the same batch: if the re-stamped
  `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` hold the local CLI defaults,
  hosted gallery presigned URLs sign with the wrong keys (endpoint is now
  the Hippius constant) → 403. If a hosted gallery image URL 403s, re-set
  the Hippius keys (live-verified in the dev shell 2026-10-24,
  `supabase/tests/s3-presign.ts` round-trip).
- Follow-up (owner request, still open): sweep the whole app for
  dev/local values that leaked into prod — code defaults, email templates,
  DNS (function secrets are covered above).

### Registration confirmation email is unbranded (2026-10-24)
The guest's first email was GoTrue's default confirmation template —
plain and unstyled — while the site's own emails are branded.
- Root cause: the project held the default template's inline HTML in the
  `mailer_templates_confirmation_content` setting (a malformed URL value
  at the time — see the fabricated-fetch OPEN entry) and GoTrue silently
  fell back to the built-in default; the fallback never errors.
- Final state (2026-10-26): the branded confirmation template is
  **inlined** in the store config (canonical file
  `static/email/confirmation.html`, byte-identical to the store); the
  magic-link template is still the built-in default (only its subject is
  branded). Rebrand recipe: [Mail](/mail.md), Email templates.
- Lesson: a broken template never breaks auth, only the branding —
  verify any template change with a real send, not by reading the config
  back.

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

## WATCH

### UMich can still tempfail — keep an eye on it (2026-10-24)
umich.edu's gateway temp-fails in drifting windows (accept/reject days
interleave even for the same sender→recipient). Since the 2026-10-26
inlined-template fix, every send has been accepted; before it, the
tempfails killed registration attempts.
- Semantics if it happens: on the signup path GoTrue sends the
  confirmation email **synchronously** inside the user-creation
  transaction — a send failure 500s the `POST /otp` **and rolls the user
  row back** (nothing half-exists); the magiclink-to-existing-user path
  still 200s (invisible failure). The register page's 4× retry
  (10/30/60 s) is the backstop.
- Diagnose: `journalctl -u maddy` — `DATA error 451 "denied by local
  policy"` from mx1/mx2.a.mail.umich.edu (Mimecast), after a clean
  `RCPT ok`; Maddy's queue stays empty (451 is returned, never retried).
  The relay logs `[submit] delivery … failed` for the same event.
- If it recurs on **rendered** bodies (check the
  `/var/lib/mail-relay/captures/` file for the body), sender
  reputation/IP is the suspect — a hosting problem: wait out the window,
  move to a clean datacenter IP, or a transactional provider (see the
  FIXED entry above for the options). Don't confuse with the
  2026-10-24 corrupt-DKIM incident (same 451 signature — verify the DNS
  record first if it recurs).

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
