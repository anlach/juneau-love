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

## OPEN

### Email action links 404: GoTrue builds `SiteURL + /verify`, no such route (2026-10-25)
The confirmation (and magic-link) action link is `https://juneau.love/verify?token=…&type=…&redirect_to=…` — GoTrue's default confirmation URL path resolved against `site_url`. The site had no `/verify` route, so clicking the link in a received email landed on the SPA's 404; with `mailer_autoconfirm=false` and sign-in disabled for unconfirmed emails, a guest who received the email could **never confirm and could never log in**. Discovered 2026-10-25 while fixing the template-URL bug, by tracing GoTrue v2.197.0's link construction (`emailParams.ConfirmationURL = externalURL.ResolveReference(getPath(...))`) and probing the live site.
- The config-side fix is not available: `site_url` must stay `https://juneau.love` (the `redirect_to` rewrite — [project notes](/project.md)), and the hosted Management API's 243-key auth schema has no `mailer_url_paths_*` key (a PATCH containing them returns 200 and silently drops them — same failure class as the old `smtp_pass` drop).
- Fix (committed, branch `relay-submit-crash`): a client-only `/verify` route that passes the query string through to `https://<ref>.supabase.co/auth/v1/verify`; GoTrue confirms the email / creates the magic-link session and 303s back to `redirect_to` with the session in the URL fragment, which supabase-js installs (probe-verified: bad token → 303 to `juneau.love/register` with an error fragment, so the `redirect_to` is accepted by GoTrue's redirect validation).
- Status: code committed + built; pending Pages deploy (push to `main`) and a live email-click test.

### Registration email delivered as a link to the template file (2026-10-25)
The 02:14 and 02:24 UTC confirmation emails (raw headers verified from the
owner's inbox) had **both** the `text/plain` and `text/html` parts
containing only the string
`https://juneau.love/email/confirmation.html` (43 bytes, no newline) —
GoTrue rendered the template *URL* as literal text. The subject was the
custom branded one, so GoTrue's `loadEntry` "succeeded": its
`loadEntryBody` `fetch()` of the configured URL returned HTTP 200 with
the URL string itself as the body, and `html/template` parsed that as a
literal-text template. The fetched result was cached (10 min max age),
which is why both sends in the window carried the same broken body.
- The live URL now (and at every subsequent check) serves the real 2563-
  byte template from GitHub Pages, and every Pages deploy in the window
  contained the full file in-tree — the transient 200-with-URL-body is
  not reproducible from the ground, so the GoTrue/fetch-side root cause
  stays unexplained (candidate: transient behavior at the Pages
domain/deploy edge — the site file re-deployed at 02:33:04 UTC, 9 min
  after the last broken send).
- Mitigation (defense in depth, on the side we control): the relay shim
  now detects the degenerate case — rendered HTML body that is a bare
  `http(s)` URL — and fetches the real document itself (10 s timeout,
  1 MB cap, mirroring GoTrue's limits) before re-sending; any fetch
  failure falls back to the body as given so the problem stays visible.
  Covered by `infra/mail/test_relay_submit.py` §[4]. The relay's
  template-URL resolution fired in production at 14:53/14:58 UTC on
  2026-10-25 ("resolved template URL … (2541 bytes)") — the degenerate
  fetch recurred after the fix, and the mitigation worked as designed.
- **Second degenerate mode** (relay journal 15:43 UTC same day): the
  fetch returned an **empty** body; the submitted message had no body
  and the shim's parse failed ("no header/body separator") → 451 →
  signup rolled back. Not catchable by the URL resolver (nothing to
  resolve) — avoided entirely by the template-settings reset below.
- **umich 451s** (14:53/14:58): the relay-reshaped branded emails were
  temp-rejected by `mx1/mx2.a.mail.umich.edu` ("denied by local
  policy") while the same shape was accepted at 02:14/02:24 (including
  the 43-byte URL-body email) — consistent with the documented
  intermittency; content (real branded HTML vs 43-byte body) is the
  prime suspect.
- **Decisive mitigation (applied 2026-10-25, read-back verified)**:
  `mailer_templates_confirmation_content` and
  `mailer_templates_magic_link_content` reset to **empty** so GoTrue
  uses its built-in defaults with **no template fetch at all**; subjects
  set to the defaults too. Rebrand only once the fetch flakiness is
  understood (see [Mail](/mail.md) for the rebrand recipe).
- Status: mitigation shipped with the crash fix (branch
  `relay-submit-crash`); pending production deploy + a live registration
  test to the owner's inbox.

### Mail relay process crashes on any submit-session error (2026-10-25)
The relay's `:465` GoTrue submission handler takes the whole process down
(HTTP relay + every edge-function mail send included) whenever a session
errors. Observed in production 2026-10-25 02:49:32 UTC:
`Uncaught (in promise) TypeError: Cannot convert object to primitive
value` at `handleSubmitConn`'s error handler, relay down ~5 s (systemd
restart), in the middle of the owner's registration attempts (the 02:14
and 02:24 UTC confirmations delivered fine; the 02:49 session produced
nothing).
- Root cause: in Deno 2.9.7 `conn.remoteAddr` is a **null-prototype
  object** (no `toString`/`valueOf`), so the `${conn.remoteAddr}`
  interpolation in the error path throws the TypeError *while handling
  the original error* → unhandled rejection → process exit. Two sites:
  the outer catch (`session error (${conn.remoteAddr})`) and the
  bad-credentials log. A single `AUTH PLAIN` with wrong credentials
  crashes the relay — an internet scanner can kill the mail path.
  Secondary: the inner catch's `await reply("451 …")` is unguarded, so
  a reply write to a vanished client (RST/timeout) propagates to the
  outer catch and hits the same landmine.
- Fix: `addrToString()` (property-based, never interpolates the raw
  object) for all address logging; `errToString()` for error values;
  the inner `451` reply is wrapped so a vanished client cannot escape
  into the outer catch.
- Repro: `infra/mail/test_relay_submit.py` (spawns the real `relay.ts`
  against a local sink; pre-fix, the bad-AUTH session kills the process
  with the exact production stack trace at `relay.ts:661:51`; post-fix,
  all 28 checks pass including post-crash-trigger recovery).

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
`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` (secret values are unreadable).
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

## WATCH

### UMich intermittently 451s auth mail — "denied by local policy" (2026-10-24)
Registration for a `umich.edu` address can fail with
"Registration didn’t go through (Error sending confirmation email)": on the
signup path, GoTrue's `POST /otp` returns the SMTP failure **synchronously**
(`MagicLink` → `Signup` sends the confirmation email inside the user-creation
transaction; a send failure 500s *and rolls the user row back*) — unlike the
magiclink-to-existing-user path, which still 200s (the 2026-10-23
invisible-failure mode).
- Trace (Maddy journal): authenticated hand-off clean
  (`username: notify@juneau.love`), `RCPT ok`, then
  `DATA error 451 "Message Tempfailed: denied by local policy"` from
  mx1/mx2.a.mail.umich.edu (Mimecast). The SMTP password is **not** involved —
  gmail / proton.me / yopmail deliveries from the same Maddy were all
  accepted, and umich itself accepted the same sender→recipient pair the
  same morning (06:09, the DKIM-fix verification send).
- Interleave: 10-23 23:03 451 → 10-24 06:09 accepted → 15:55 451 ×2 →
  16:20 relay test to the same address **accepted** → 16:27 451 ×2 →
  16:40 relay test carrying GoTrue's exact subject + rendered body
  **accepted** — inside the very window GoTrue's own sends were 451'd.
  Sender-side auth is intact (SPF, DKIM TXT vs on-disk key byte-for-byte,
  DMARC, PTR all verified 2026-10-24); Maddy's queue stays empty (451 is
  returned to GoTrue, never retried).
- Message-shape effect: GoTrue-formatted mail (single-part `text/html`,
  Message-ID `@<ref>.supabase.co` — `internal/mailer/mailmeclient` does
  `gomail.NewMessage` + `SetBody("text/html", …)`, no plain part) went
  1/6 to umich, while multipart text+html mail from the same IP/SPF/DKIM
  went 2/2, both umich accepts inside the GoTrue-451 window. umich's
  gateway scores GoTrue's message shape borderline for this
  Choopa-residential IP and tempfails it intermittently; neither the MIME
  shape nor the Message-ID domain is configurable in hosted GoTrue (its
  mailer pins `gomail v2`), so the shape is changed **after** GoTrue sends
  — by the relay's `:465` GoTrue submission shim (below).
- Mitigation (deployed 2026-10-25; first production send pending): GoTrue now points
  at the relay's `:465` shim (Supabase `smtp_port: "465"` set + project
  restarted), which re-sends the mail through `sendMail()` in the
  accepted shape (multipart, `Message-ID @juneau.love`, real text part).
  Verified locally end-to-end against the exact gomail handshake (465
  implicit TLS + `AUTH PLAIN`, per the pinned commit's `SSL: port == 465`)
  before deploy: 250 path delivers the rewritten mail, a 451 from Maddy's
  side comes back to GoTrue as 451 → 500 → clean rollback. Deploy notes:
  the shim's bind of privileged 465 needs
  `AmbientCapabilities=CAP_NET_BIND_SERVICE` on the unit (a bare
  `PermissionDenied: … (os error 13)` without a file path at startup =
  the bind, not the cert read). The register page's 500-retry (4
  attempts, 10/30/60 s) is the backstop if a tempfail window still
  outlasts it. Rollback: `smtp_port: "587"` + project restart. Design and
  runbook: `knowledge/platform/mail.md` (shim section),
  `infra/mail/README.md` §6a/6b.
- If umich starts 451ing the **relay-shaped** mail too (check
  `journalctl -u mail-relay` for `[submit] delivery … failed`),
  sender reputation is the suspect — that is a hosting/IP problem, not a
  mail-stack one.
- Not confused with: the 2026-10-24 corrupt-DKIM incident (FIXED, same
  451 signature — verify DNS first if it recurs).

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
