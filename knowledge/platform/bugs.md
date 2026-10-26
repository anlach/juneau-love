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

### GoTrue's template-fetch egress is fabricated host-independently (2026-10-26)
Definitive evidence from a controlled experiment that the hosted GoTrue's
`loadEntryBody` `fetch()` of the configured template URL **never reaches
the target host** — it gets a fabricated HTTP 200 whose body is either
the URL string (mode 1) or empty (mode 2). Timeline, all 2026-10-26:
- **02:21:44** PATCH store → `mailer_templates_confirmation_content` =
  `https://mail.juneau.love/gotrue/confirmation.html` (VPS nginx, logged
  fetches). **02:22:22** send: relay capture #7 = full headers + body
  **URL string** (mode 1). VPS nginx: **no fetch from any Supabase IP**
  (only the relay's own resolver fetch from 66.42.121.163).
- **02:31:27** second send: mode 1 again, same pattern.
- **02:48:55** PATCH store → `""`. **02:49:33** send: capture #9 =
  headers + blank separator + **zero body** (mode 2) — a
  fetch-derived empty, i.e. the running process was still fetching the
  VPS URL (GoTrue's built-in default is a static non-empty template and
  would never render empty). So the **empty write did not propagate**
  (non-empty writes propagate <60 s — see the 02:21→02:22 send).
- **03:11:13** PATCH store → `https://asuupanisvfxvbmdpcxt.supabase.co/
  functions/v1/email-template` (new edge function, same origin as
  GoTrue). **03:12:41** send: capture #10 = **mode 1 with the function
  URL as body** — own-origin fetch broken identically.
- **Control**: the `email-template` edge function's own outbound fetches
  of the VPS template at 03:10:57 and 03:12:41 appear in the VPS nginx
  log from Supabase edge IPs (35.90.57.216, 3.142.55.211, UA
  `SupabaseEdgeRuntime/1.77.7; ref=asuupanisvfxvbmdpcxt`) — the
  platform's egress works fine; only GoTrue's template fetch is broken.
- Mode mix observed on the VPS URL: mode 1, mode 1, mode 2 — looks
  random. (Also resolved the 2026-10-25 "bodyless" entry's open
  questions: the wire IS a well-formed empty text/html message —
  headers + `\r\r\n` + `.`; the missing trailing CRLF in old captures
  was the relay's `join("\r\n")` artifact, now fixed; the mode-2
  renders empty because the fetch returned an empty 200, not because
  the built-in default is broken.)
- **Shipped mitigation (2026-10-26)**: store template → the public
  `email-template` edge function (live-fetches the VPS template with an
  embedded fallback). Even in mode 1 the relay's `resolveTemplateUrl`
  rescues the send (it fetches the function URL itself) → full branded
  email with a valid confirmation link, verified at 03:12:41 and
  03:26:20 ("resolved template URL … (2541 bytes)"). Mode 2 remains a
  coin-flip per send (451 → clean rollback → register page retries at
  10/30/60 s re-roll it). Supabase-side fix is out of our hands;
  candidate for a support ticket ("GoTrue mailer_templates_* URL fetch
  returns 200 with URL-string/empty body; request never reaches
  host").
- Side findings: (1) Supabase CLI binary was missing from this machine
  (only `~/.supabase/cli-latest` marker `v2.121.0` remained) — restored
  to `~/.local/bin/supabase` (v2.121.0, official GitHub release tarball;
  the release publishes no checksum file). Functions deploy as eszip
  bundles via the Docker/podman bundler — the Management API rejects
  raw zips, so **the CLI is required** for function deploys. (2)
  `mail-relay.service` now has `--allow-read` AND `--allow-write` for
  the capture dir (both were missing; "[submit] captured …" line now
  logs, prune works) and the relay's CRLF-faithful capture reconstruction
  is deployed (backups: `/root/relay.ts.bak-20261026`,
  `/root/mail-relay.service.bak-20261026`).

### UMich 451 "denied by local policy" = sending-IP reputation / Spamhaus PBL (2026-10-26)
`mx1/mx2.a.mail.umich.edu` temp-fail the relay's outbound mail from
66.42.121.163 intermittently while gmail accepts the same IP/shape 3/3.
Today's findings pin the cause to the **IP**, not the message:
- **Spamhaus PBL**: `66.42.121.163.zen.spamhaus.org` → 127.255.255.254
  ("possibly residential" — Choopa/Exoscale residential-range
  classification; PBL is a range property, **not delistable**). DBBL,
  UCEPROTECT, Barracuda all clean.
- umich history (maddy journal): accepts 10-24 06:09/16:20/16:40/19:04,
  10-25 02:13/02:24/18:32/18:40; 451s 10-24 15:55/16:27/18:35, 10-25
  14:53/14:58, 10-26 02:22/02:31/03:12/03:23/03:26. The 10-24/10-25
  accepts predate the open-relay spam (10-23→10-24 21:11) or fall in
  lulls; the 451s correlate with the spam window + PBL. The open relay
  itself is fixed (10-25 21:51, entry above) — the reputation damage is
  what remains.
- Consequence: umich-bound registrations will keep hitting 451
  tempfails (clean rollback, register page retry may or may not hit an
  accept window) until the IP's reputation decays or the mail moves off
  the IP. Structural options for the owner to decide: (a) wait days–
  weeks for decay (unpredictable, gmail already shows the IP is
  tolerated by many); (b) **new clean datacenter sending IP** — the
  `infra/mail/` runbook (relay + maddy + DNS: A/MX/SPF for
  mail.juneau.love) is designed to be portable; (c) transactional
  provider (Resend/SES/Postmark) for auth mail.

### Email action links 404: GoTrue builds `SiteURL + /verify`, no such route (2026-10-25)
The confirmation (and magic-link) action link is `https://juneau.love/verify?token=…&type=…&redirect_to=…` — GoTrue's default confirmation URL path resolved against `site_url`. The site had no `/verify` route, so clicking the link in a received email landed on the SPA's 404; with `mailer_autoconfirm=false` and sign-in disabled for unconfirmed emails, a guest who received the email could **never confirm and could never log in**. Discovered 2026-10-25 while fixing the template-URL bug, by tracing GoTrue v2.197.0's link construction (`emailParams.ConfirmationURL = externalURL.ResolveReference(getPath(...))`) and probing the live site.
- The config-side fix is not available: `site_url` must stay `https://juneau.love` (the `redirect_to` rewrite — [project notes](/project.md)), and the hosted Management API's 243-key auth schema has no `mailer_url_paths_*` key (a PATCH containing them returns 200 and silently drops them — same failure class as the old `smtp_pass` drop).
- Fix (committed, branch `relay-submit-crash`, merged to `main` as `7568251` via PR #4): a client-only `/verify` route that passes the query string through to `https://<ref>.supabase.co/auth/v1/verify`; GoTrue confirms the email / creates the magic-link session and 303s back to `redirect_to` with the session in the URL fragment, which supabase-js installs (probe-verified: bad token → 303 to `juneau.love/register` with an error fragment, so the `redirect_to` is accepted by GoTrue's redirect validation).
- Status: **deployed + verified live 2026-10-26** (headless-browser probe of `https://juneau.love/verify?token=badtoken…` followed the full hop and landed on `/register` with the GoTrue error fragment `access_denied&error_code=otp_expired`). Deep links to any `ssr = false` route 404 at the HTTP level (static host, `fallback: '404.html'` is a full app-boot shell) but work in browsers — the SvelteKit client router renders the route client-side (see the note under the status legend).

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

### GoTrue sends a bodyless confirmation email — empty body, relay 451, signup rolled back (2026-10-25)
Production captures (relay `:465` capture, deployed 92e7ebb; files in
`/var/lib/mail-relay/captures/`, 0600) from the owner's registration
attempts at **18:34:54** and **21:50:43** UTC — both 246 bytes, identical
shape:

```
Mime-Version: 1.0
Date: Sun, 25 Oct 2026 21:50:43 +0000
From: "juneau.love" <notify@juneau.love>
To: lacharit@umich.edu
Subject: Confirm your email address
Content-Type: text/html; charset=UTF-8
Content-Transfer-Encoding: quoted-printable
```

i.e. exactly the 7 header lines, **one blank line, then the `.`
terminator — zero body bytes**. (Header order differs between the two
captures — From/To/Subject come from a Go map, random order; consistent
with GoTrue's gomail v2 writer, which writes each header, the blank line
and each body chunk as separate connection writes.)
- The relay is exonerated: its `Lines` reader is a plain buffered line
  reader (no drops), and the capture file is
  `bodyLines.join("\r\n")` — the file's trailing CRLF proves the blank
  line **was** read; the next line read was `.`. The wire stream really
  was headers + blank + dot. (The "no header/body separator" parse error
  at relay.ts:495 is the downstream symptom — the separator IS present;
  the body is simply empty. Misleading message, worth renaming.)
- Consequence chain: relay replies `451` → net/smtp `msgWriter.Close()`
  returns the server error → gomail `DialAndSend` errors → GoTrue 500s
  the signup and rolls the user row back → "Registration didn’t go
  through (Error sending confirmation email)".
- This is a **new degenerate mode** (the template-URL entry above has
  modes 1 = URL-as-body and 2 = empty fetch), and it occurred after the
  template-content settings were reset to empty (built-in defaults, no
  fetch) — so either the built-in default template rendered empty, the
  running GoTrue's settings/config differ from the store (same failure
  class as the dropped `smtp_pass` writes), or the running GoTrue is not
  v2.197.0. Open at pause time:
  - is "Confirm your email address" GoTrue's built-in default
    confirmation subject, or a configured value? (grep of the local
    `configuration.go` copy finds no such string — the default lives in
    another package file not yet fetched; local gotrue-src copies are
    partial: `gomail-message.go`/`real-templatemailer.go` are 404
    artifacts, `template-defaults.go` is a mislabeled duplicate of
    templatemailer.go.)
  - read back the live `mailer_templates_confirmation_content`,
    `mailer_subjects_confirmation`, `mailer_url_paths_*`, `site_url`
    via the Management API (read-back ≠ running value, per the
    stale-credentials history — treat as one data point only).
  - Supabase-side GoTrue logs (dashboard) for those two timestamps:
    template load/render errors, the `mail.send` event, the reported
    SMTP error.
- **Resolved 2026-10-26** (see the fabricated-egress entry above):
  these bodyless sends were **mode 2** — GoTrue's fabricated template
  fetch returned an empty 200, the (non-empty, store-held) template
  rendered empty, and GoTrue submitted a well-formed empty text/html
  message. The store held the VPS template URL the whole time (the
  "reset to empty" writes had not propagated to the running process).
  "Confirm your email address" is the default GoTrue confirmation
  subject (store value, read back 2026-10-26). Current state: store
  template → `email-template` edge function URL; mode 1 rescued by the
  relay, mode 2 still 451s (retry re-rolls).
- **Capture bug found while using it — FIXED 2026-10-26**: the mail-relay
  unit lacked `--allow-read` *and* `--allow-write` for
  `/var/lib/mail-relay/captures`, so `captureSubmission` threw
  `NotCapable` (prune's `Deno.readDir`, and once read was granted, the
  file write) — the file sometimes saved but the `[submit] captured …
  bytes=… term=…` log line never printed. Both flags now in
  `mail-relay.service`; line verified logging in production.
  Separately, the deployed relay now reconstructs captures
  CRLF-faithfully (repo diff from 2026-10-25 deployed 2026-10-26), so
  the mode-2 shape captures as headers + blank line (parseable
  empty-body message) instead of the misleading single trailing CRLF.

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

### Maddy `:587` is an open relay — unauthenticated external spam submitted + relayed (2026-10-25)
The public submission listener in `/etc/maddy/maddy.conf` is a plain
`smtp` endpoint, which makes AUTH **optional**: any client on the
internet can `MAIL FROM`/`RCPT TO`/`DATA` to external recipients without
credentials, and Maddy relays it (`default_destination → deliver_to
remote`, no allow/deny rules). `maddy` 0.9.5 docs: the `submission`
module is `smtp` + “authentication is always required”.
- Evidence (Maddy journal, VPS 66.42.121.163): 20 external
  submissions accepted 2026-10-23 → 10-24 21:11 UTC, from public IPs
  (201.55.163.206, 46.151.182.204) with spoofed senders
  (`info@nsk.ne.jp`, `info@m.carpenterfunds.com`,
  `postmaster@66.42.121.163`), recipients on hotmail/yahoo/aol/gmail.
  Several were **delivered** (21:10:38 entry: per-rcpt `null` =
  success); the rest 550'd at the recipient gateways with SPF/DKIM
  failures *naming this VPS's IP* (`SPF nsk.ne.jp with ip
  66.42.121.163 = FAILURE`) — i.e. the IP is now associated with spam
  by those gateways. Live reachability confirmed 2026-10-25: :587
  banner from outside the VPS while the loopback :25 stays private.
  No external submissions since 10-24 21:11 (abusers moved on, or the
  provider is filtering — unverified).
- **This is a leading suspect for the UMich 451s** (WATCH entry above):
  relay abuse is a textbook IP-reputation poison, and umich's "denied
  by local policy" tempfail is exactly what reputation-based gateways
  do. Fixing the relay and letting the reputation recover may be what
  the 451 issue actually needs.
- Fix (pending, one-word change): in `maddy.conf` rename the `:587`
  endpoint from `smtp` to `submission` (same children: `auth
  pass_table file /etc/maddy/smtp_passwd`, same
  `default_destination`), `sudo maddy verify-config`, then
  `sudo systemctl reload maddy` (or restart). GoTrue is unaffected — it
  already authenticates (the Oct 24 18:35 log line shows
  `username: notify@juneau.love` on :587; today it uses the :465 shim
  anyway). Unauthenticated clients then fail at `MAIL FROM`.
- Until fixed: every spam relay through the VPS further poisons the IP.
- **Fixed 2026-10-25 ~21:51 UTC** (owner-approved): `:587` endpoint
  renamed `smtp` → `submission` in `/etc/maddy/maddy.conf` (backup:
  `/root/maddy.conf.bak-20261025`), `maddy verify-config` clean,
  service restarted. Verified from outside the VPS: banner + EHLO
  fine, unauthenticated `MAIL FROM` → `502 5.7.0 Please authenticate
  first`. (AUTH is only advertised post-STARTTLS, as before — the
  authenticated GoTrue path is unchanged; GoTrue today uses the :465
  shim anyway.)

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
  mail-stack one. **The Maddy `:587` open relay (OPEN entry above, found
  2026-10-25) is the prime reputation suspect: the VPS relayed external
  spam Oct 23–24, and the recipient-gateway rejections in that window
  name the VPS IP explicitly. Fix it before drawing further conclusions
  about umich.**
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
