---
type: project-notes
title: Mail (self-hosted Maddy)
description: The self-hosted mail stack on the VPS — Maddy for delivery, the HTTP->SMTP relay that edge functions must use, DNS records, the GoTrue email templates, and the Supabase SMTP/secret settings it requires.
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-24T16:00:00Z }
---

# Mail (self-hosted Maddy)

All site email leaves from the site's own VPS: the edge functions'
transactional emails (login links — [send-login-link](../api/send-login-link.md),
admin registration alert — [notify-registration](../api/notify-registration.md),
and the approve invite in
[registration-decision](../api/registration-decision.md)) plus GoTrue's own
auth emails (confirmation link, signup). There is no third-party email
provider and no mailbox — juneau.love sends, it does not receive.

## Topology

```
browser → Supabase edge functions (Deno)
              │  HTTPS POST /send (Bearer token)
              ▼
        nginx mail.juneau.love:443   (certbot-managed cert, shared vhost)
              │  reverse_proxy
              ▼
        relay.ts  127.0.0.1:8080      (zero-dependency Deno service)
              │  SMTP (loopback, unauthenticated)
              ▼
        Maddy   127.0.0.1:25          (DKIM signing, direct MX delivery → internet)
              ▲
              │  SMTP 465 implicit TLS, user notify@juneau.love
        Supabase GoTrue (auth emails) → relay's :465 GoTrue shim,
              re-sent through sendMail() — see the shim section below;
              the pre-2026-10-24 path was straight to Maddy's :587
```

The install/runbook lives in `infra/mail/` in the repo (relay source,
`maddy.conf`, `nginx-mail.conf`, systemd unit, step-by-step README).

## Why the relay exists

The Supabase edge runtime denies raw TCP: a deployed function's worker is
created with an empty net permission scope, so `Deno.connect` is
`NotCapable` and only `fetch` is available (verified against the
`supabase/edge-runtime` source, 2026-10-20 —
`crates/base/src/runtime/permissions.rs`, `WorkerKind::UserWorker` with
`allow_net: Some(vec![])`). Maddy has no HTTP API. Therefore the relay:
a ~300-line zero-dependency Deno service on the VPS that takes a JSON
email over HTTPS and speaks SMTP to Maddy on loopback.

## Components

| Piece | Role | Notes |
|---|---|---|
| Maddy | The mail server: DKIM signing, direct MX delivery | send-only; loopback `:25` hand-off + `:587` STARTTLS submission; no local mailboxes |
| relay.ts (`infra/mail/relay.ts`) | HTTP→SMTP for the edge functions **and the `:465` GoTrue submission shim** | loopback HTTP with bearer-token auth; :465 implicit-TLS SMTP with `AUTH PLAIN` as `notify@juneau.love`; ≤10 recipients / 256 KB per part, multipart/alternative (text+html), RFC 2047 subjects, fixed From |
| nginx (mail vhost) | TLS at `mail.juneau.love:443` | server blocks on the existing nginx (which fronts other sites on :80/:443); certbot webroot issues + auto-renews; the only public mail-adjacent HTTP surface |
| GoTrue SMTP | Auth emails (confirmation, signup) | Supabase "custom SMTP" project setting → `mail.juneau.love:465` (the relay shim); `rate_limit_email_sent` is 30 msg/hour (the GoTrue default; it had been set to 2, which 429'd repeated login attempts invisibly — raised 2026-10-23). Failed SMTP sends are still invisible to the client: GoTrue answers 200 anyway (signup `POST /otp` is the exception — it 500s and rolls back; see bugs.md) |

## DNS (juneau.love)

| Type | Name | Value |
|---|---|---|
| A | `mail.juneau.love` | the VPS IP |
| TXT (SPF) | `juneau.love` | `v=spf1 ip4:<VPS IP> -all` |
| TXT (DKIM) | `mail._domainkey.juneau.love` | public key Maddy generates (state dir `dkim_keys/`, selector `mail`) |
| TXT (DMARC) | `_dmarc.juneau.love` | `v=DMARC1; p=quarantine;` |
| PTR (provider) | VPS IP | `mail.juneau.love` — must match the A record and Maddy's `hostname` |
| MX | — | **none on purpose** — the domain receives no mail |

## Secrets

| Secret | Where it lives | Never |
|---|---|---|
| relay token | VPS: `/etc/mail-relay/env` (mode 0600); Supabase: `MAIL_RELAY_TOKEN` edge function secret (same value, both sides must agree) | repo |
| Maddy submission password (for GoTrue) | VPS: only as the hash in `/etc/maddy/smtp_passwd`; the plaintext is stored only as `smtp_pass` in the Supabase project SMTP setting | repo |

The TLS cert for `mail.juneau.love` is a Let's Encrypt cert managed by
**certbot** (webroot through the nginx ACME-challenge location) and covers
both the relay vhost and Maddy's :587 listener — maddy reloads it from
disk on renewal. No DNS-provider API token is involved.

`MAIL_RELAY_URL` (`https://mail.juneau.love`) is a hosted setting, not a
secret — it still lives as an edge function secret so the deploy is one
command (see [project notes](/project.md), Deploy).

## Supabase settings this design requires

- Edge function secrets: `MAIL_RELAY_URL` + `MAIL_RELAY_TOKEN`.
- GoTrue custom SMTP (Management API `PATCH /projects/{ref}/config/auth`
  or dashboard → Auth → SMTP): host `mail.juneau.love`, port **465**
  (the relay's GoTrue submission shim, below), user `notify@juneau.love`,
  password per above, sender `notify@juneau.love`, sender name
  `juneau.love`, autoconfirm **off**, external email **on**. The command
  is in `infra/mail/README.md`. Port 587 (Maddy directly) is the
  rollback path.
- GoTrue email templates: two `mailer_templates_*_content` URL settings
  plus subjects — see [Email templates](#email-templates-gotrue) below.

## GoTrue submission shim (relay `:465`, added 2026-10-24)

GoTrue's auth emails are **re-sent by the relay in the relay's own
message shape**: GoTrue dials `mail.juneau.love:465` (implicit TLS),
authenticates as `notify@juneau.love` (`SMTP_SUBMIT_PASSWORD` in
`/etc/mail-relay/env`), sends its message, and the relay hands it to
Maddy `:25` through the same `sendMail()` the edge functions use.

**Why** — umich.edu's gateway (Mimecast) intermittently `451`s GoTrue's
native shape (single-part `text/html`, `Message-ID @<ref>.supabase.co`,
residential IP) while accepting the relay shape: 1/6 vs 4/4 across three
windows with the same recipient and identical content (A/B table in
[bugs.md](/bugs.md)). Neither attribute is configurable in hosted
GoTrue (its mailer pins `gomail v2`), so the shape is changed after GoTrue
sends — by the relay.

**Wire protocol** (verified against the exact gomail commit GoTrue pins,
`gopkg.in/gomail.v2@v2.0.0-20160411212932-81ebce5c23df`): `NewDialer`
sets `SSL: port == 465` → implicit TLS, server cert verified against
`smtp_host` → `EHLO` → `AUTH PLAIN` (Go stdlib, inline response) →
`MAIL/RCPT/DATA`. Hence the shim is a plain `Deno.listenTls` (no
STARTTLS) serving a **staging copy** of the LE cert in
`/etc/mail-relay/tls/` (the `mailrelay` user can't read
`/etc/letsencrypt`); the certbot deploy hook
`renewal-hooks/deploy/mail-relay.sh` re-copies and restarts `mail-relay`
on renewal. Port 465 can't be swapped for an unprivileged one — gomail
only uses implicit TLS when the port is exactly 465 — so the unit
carries `AmbientCapabilities=CAP_NET_BIND_SERVICE` (465 < 1024; the
service runs as unprivileged `mailrelay`). Diagnostic: a bare
`PermissionDenied: ... (os error 13)` **without a file path** at startup
means the privileged bind failed (missing capability), not a cert read
problem (which names the file).

**Failure semantics** — delivery failure → shim returns `451` → GoTrue
500s the signup → the **whole signup rolls back** (no orphaned user row;
verified in GoTrue v2.197.0) → the register page's 500-retry (4 attempts,
10/30/60 s backoff) or a manual retry is a clean fresh attempt. Bad
credentials → `535`, connection dropped. A session error must never take
the process down: `conn.remoteAddr` is a null-prototype object in
Deno 2.9.7 (no `toString`/`valueOf`), so it is only ever printed through
`addrToString()`, and the `451` reply write is guarded (2026-10-25
production crash — one bad AUTH killed the relay for ~5 s; see
[bugs.md](/bugs.md)).

**Template-URL fallback** — GoTrue's `mailer_templates_*_content`
settings are URLs it GETs and parses as Go `html/template`; in
production (2026-10-25) the fetch once came back with the URL string
itself as the body, so the guest's email contained only the link to the
template file. The shim detects that degenerate case — a rendered HTML
body that is a bare `http(s)` URL — and fetches the real document itself
(10 s timeout, 1 MB cap, mirroring GoTrue's), re-deriving the text part;
any fetch failure falls back to the body as given. Covered by
`infra/mail/test_relay_submit.py` §[4].

**Rollback** — `PATCH smtp_port: "587"` + project restart restores the
pre-2026-10-24 direct-to-Maddy path (the `:587` listener stays up).

**Deploy/runbook:** `infra/mail/README.md` sections 3, 6a, 6b.

## Email templates (GoTrue)

GoTrue's own auth emails — the signup confirmation, and the magiclink
the register page's "already registered" probe triggers for a known
email (the only path that uses the magiclink template) — are templated
by project settings, not by site code:

- The template **content** setting (`mailer_templates_*_content`) is a
  **URL**, not inline HTML (GoTrue v2.197.0, verified in source): the
  running GoTrue GETs it (relative values resolve against `SiteURL`),
  parses the result with Go's `html/template`, and caches it for
  10 minutes. The template **subject** settings (`mailer_subjects_*`)
  are inline template strings.
- **A fetch or parse failure silently falls back to the built-in
  default template** — the email still goes out, just unbranded, with
  no error anywhere. That is how the project shipped with the default
  confirmation email while a (dead) inline-HTML "template" sat in the
  setting (2026-10-24 — [bug list](/bugs.md)). Reading the setting back
  is not a valid check that the template is live; verify with a real
  send.
- **A *successful* fetch can still degenerate** (2026-10-25, verified
  twice; **root-caused 2026-10-26 — see the fabricated-egress entry in
  [bug list](/bugs.md)**). Mode 1 (raw email): the GET "returned" HTTP
  200 with the URL string itself as the body, so GoTrue parsed the URL
  as a literal-text template and the guest received an email whose
  entire content was the link to the template file. Mode 2 (relay
  journal 15:43): the GET "returned" an **empty** body → submitted
  message with zero body bytes → relay 451 → whole signup rolled back.
  The 2026-10-26 controlled experiment proved the fetch **never
  reaches the target host at all** — no mode-1/mode-2 request appears
  in the target's access log from any Supabase IP, for VPS-hosted or
  supabase.co-hosted URLs alike, while edge-function egress from the
  same project works normally. Treat every non-empty
  `mailer_templates_*_content` value as producing either a mode-1 or a
  mode-2 send at random. GoTrue's "silent fallback to built-in default
  on fetch failure" never fires because the fabricated response is a
  200, not a failure. Also: **empty-string writes to the store do not
  reliably propagate to the running GoTrue** (non-empty writes
  propagate in <60 s) — the built-in-default escape hatch via config
  is unusable without a service restart.
- The rendered body is sent as `text/html`, with no plain-text part.
- Confirmation/magiclink template variables: `.ConfirmationURL` (the
  action link — both types use this name), `.Email`, `.Token`,
  `.TokenHash`, `.Data` (user metadata — the registration's
  `display_name`; may be nil, guard with nested `with` actions),
  `.RedirectTo`, `.SiteURL`.
- The templates are repo files. **Current production architecture
  (2026-10-26)**: the canonical file is `static/email/confirmation.html`
  (repo), deployed to the VPS as
  `/var/www/mail-relay-templates/confirmation.html` and served at
  `https://mail.juneau.love/gotrue/confirmation.html` (fetches logged to
  `/var/log/nginx/gotrue-template-fetches.log` — the observability
  point that exposed the fabricated egress). The store's
  `mailer_templates_confirmation_content` points at the public edge
  function **`https://asuupanisvfxvbmdpcxt.supabase.co/functions/v1/
  email-template`** (`supabase/functions/email-template/index.ts`,
  deployed with `--no-verify-jwt`): it live-fetches the VPS URL and
  falls back to an embedded copy of the template. Even when GoTrue's
  broken egress produces mode 1 (function URL as body), the relay's
  `resolveTemplateUrl` fetches that public function itself and
  re-sends the full branded email with a valid confirmation link —
  verified in production 2026-10-26 (relay journal "resolved template
  URL … (2541 bytes)"). Mode 2 (empty body) still 451s and rolls back;
  the register page's auto-retry (10/30/60 s) re-rolls the mode. The
  HTML comments must not contain `{{ }}` (template actions inside
  comments break the parse). **To rebrand**: edit
  `static/email/confirmation.html` → copy to the VPS staging path (or
  update the embedded fallback in the function and redeploy: `~/.local/
  bin/supabase functions deploy email-template --no-verify-jwt`).
  `mailer_templates_magic_link_content` is still empty (built-in
  default; the magiclink path is only the register page's "already
  registered" probe). GoTrue caches template fetches ~10 min, so a
  rebrand takes effect within ~10 min without any restart.
- **Action links: the `/verify` hop.** GoTrue builds the action link as
  `SiteURL + URLPaths.Confirmation` (default path `/verify`) with
  `?token=…&type=…&redirect_to=…`. `site_url` must stay
  `https://juneau.love` (the `redirect_to` rewrite —
  [project notes](/project.md)), and the hosted Management API does not
  expose `mailer_url_paths_*` at all (243-key schema, no such key; a
  PATCH containing them returns 200 and drops them), so the link can't
  be pointed at `supabase.co` by config. Instead the site serves a
  client-only `/verify` route (`src/routes/verify/`) that passes the
  query string straight through to
  `https://<ref>.supabase.co/auth/v1/verify`; GoTrue confirms the email
  (or creates the magic-link session) and 303s back to `redirect_to`
  (the referrer — the register page) with the session in the URL
  fragment. supabase-js's `detectSessionInUrl` installs it; a pending
  signed-in user is routed to the awaiting-approval screen by the root
  layout, and `/auth/confirm` handles the same fragment. Probe-verified
  2026-10-25: bad token → 303 to `https://juneau.love/register` with an
  error fragment, so the `redirect_to` value is accepted by GoTrue's
  redirect validation.

## Local development

No relay exists locally: without `MAIL_RELAY_URL`/`MAIL_RELAY_TOKEN` the
functions run in dev mode (email printed to the function log, counted as
sent; `registration-decision` reports `email_sent: false`). GoTrue's
local stack uses Supabase's local SMTP (loopback) and, with local
autoconfirm on, never sends confirmation mail — see [project
notes](/project.md), Local development.

## Sending a reference registration email without GoTrue (`sendtest`)

To test the branded templates end to end — or to put a genuinely working
registration link into a test inbox — `infra/mail/sendtest` (Go, its own
module like `probe/`) renders the template exactly as GoTrue v2.197.0
does (template fetch limits, `html/template` escaping, `getPath`
Sprintf link order, `ConfirmationMail` data map) and POSTs the result to
the relay's `/send`, so it goes out in the relay shape. It is the
**target output** for the relay work: whatever shape a real GoTrue send
should take after the shim, `sendtest` produces it directly.

- Full usage + verification checklist:
  `infra/mail/README.md`, section 6c.
- `-token` defaults to a random 64-hex value: right link shape, confirms
  nothing (the `/verify` hop and `redirect_to` validation still get
  exercised). Pass a token captured from a real GoTrue send to make the
  link genuinely confirm an account.
- The text part is a byte-identical port of the shim's `htmlToText()`
  (verified by diff against the JS implementation).
- First successful run 2026-10-25 20:44 UTC: branded confirmation email
  to `adlacharite@gmail.com`, Maddy accepted, queue empty = handed to
  the gmail MX (inbox receipt to be confirmed by the owner).

## Rotating the Maddy submission password (GoTrue)

The `:587` listener authenticates `notify@juneau.love` against
`/etc/maddy/smtp_passwd`, one line per credential: `user: <bcrypt hash>`.
To rotate:

1. Generate a new password **on the VPS** and keep it in a mode-0600 temp
   file (never echo it into a shell history or log).
2. `maddy hash -p "$(cat /tmp/newpw)"` → the bcrypt hash. Hashes are
   **salted** — the same password hashes differently on every run. The
   hash and the Supabase-side value must both derive from the same
   plaintext.
3. Install the new file: `sudo install -o maddy -g maddy -m 600` (the
   `maddy` service user must be able to read it).
4. `sudo systemctl restart maddy` — the pass table is not reloaded on
   file change.
5. Set the same **plaintext** as `smtp_pass` in the Supabase project SMTP
   setting. The dashboard/API field takes the plaintext, never the hash
   line. (In that config the username key is `smtp_user` — there is no
   `smtp_user_name`.)
   **Observed 2026-10-23: the Management API was silently ignoring
   `smtp_pass` writes** — HTTP 200 with the old value echoed back and
   unchanged on read-back, while other fields in the same PATCH (e.g.
   `rate_limit_email_sent`, `smtp_port`) applied fine. The *running*
   GoTrue was stuck on a stale password the same day (captured with the
   sink). If the API won't take the write, set the password from the
   dashboard instead and include the symptom in the escalation.
   **Observed 2026-10-25: the read-back now *includes* `smtp_pass` (a
   64-hex string), but that value fails live AUTH against Maddy (535) —
   the real password works (235). The read-back value is not
   trustworthy; verify any candidate with a live STARTTLS + AUTH PLAIN
   from outside the VPS before trusting it.
6. Since 2026-10-24 the relay's `:465` shim authenticates the same user
   against `SMTP_SUBMIT_PASSWORD` in `/etc/mail-relay/env` — put the same
   plaintext there and `sudo systemctl restart mail-relay` (env is read
   at process start; no hot reload).

One valid hash per user: duplicate lines for the same user collapse
(first line wins — observed 2026-10-23). Verify from **outside** the VPS,
because that is GoTrue's path: STARTTLS to `mail.juneau.love:587`, AUTH
with the new credentials, expect 235. Then verify end-to-end by firing
`POST /auth/v1/otp` and checking `auth_logs` (source `auth_logs`) for a
clean send — a `535 5.7.8 Invalid credentials` there means the running
GoTrue and Maddy disagree. Reading the config back via the Management API
is not a valid verification: the config store can hold the right value
while the project host still runs the old one (observed 2026-10-23 — a
running GoTrue kept using stale SMTP credentials for over an hour, and a
full project restart did not by itself re-sync them; escalated to
Supabase support).

## Capturing what the running GoTrue actually presents (smtp-capture-tls.py)

The Management API's `GET /config/auth` is not a valid check that the
running GoTrue uses the stored SMTP credentials — the process takes its
SMTP config at startup, and a project restart may not re-provision it
(observed 2026-10-23). `smtp-capture-tls.py` closes that gap: a logging
SMTP sink that advertises `STARTTLS` **and** `AUTH PLAIN LOGIN` (exactly
as Maddy's :587 does) and serves the real Let's Encrypt cert for
`mail.juneau.love`. The sink logs the full session: decoded user +
password (clear and SHA-256), MAIL FROM / RCPT, and the complete message
— including the magic-link URL, which also reveals the running
`site_url`. It never delivers mail.

- **The sink must do TLS** (verified 2026-10-23 against the exact pinned
  gomail commit, v2.0.0-20160411212932-81ebce5c23df): that commit has no
  `StartTLSPolicy` — advertised STARTTLS is always negotiated, and
  gomail's AUTH PLAIN is Go stdlib's `smtp.PlainAuth`, whose `Start`
  **refuses a non-TLS connection** ("unencrypted connection"). The
  original no-STARTTLS `smtp-capture.py` design therefore captures
  nothing: the client sends `EHLO` then `QUIT` without any AUTH
  (reproduced with the probe). GoTrue also *verifies* the server cert
  (gomail `tls.Config{ServerName: smtp_host}`, no skip-verify), so the
  sink must serve a cert valid for `mail.juneau.love` — copy the Let's
  Encrypt fullchain/privkey to a mode-0600 temp dir (sudo; the live
  paths are root-only).
- The client re-EHLOs after the handshake; advertise both extensions in
  both EHLO responses.
- **Validate the method first**: `probe/` sends exactly the way
  `mailmeclient` does (pinned to the same gomail commit GoTrue pins).
  Sink + probe must log the exact `-user` / `-pass` you passed.
- **Hosted capture**: copy the cert, run the sink on a spare public
  port (open it in ufw first; mode-0600 log), `PATCH /config/auth`
  `smtp_port` to that port (string), fire `POST /auth/v1/otp`
  (magiclink) for an existing confirmed user (no new user row; ≥61 s
  between sends — GoTrue `SMTP.MaxFrequency`; also bump
  `rate_limit_email_sent` temporarily if the limit is low and the user
  already used their sends — the 429 is invisible in the SMTP path),
  read the
  `SUMMARY` line, compare its `pass_sha256` with the SHA-256 of the
  stored `smtp_pass`, then restore `smtp_port` and the rate limit. If
  the sink sees no connection at all, even after a project restart, the
  whole SMTP config propagation is stuck, not just the password.
- **`smtp_port` propagates, `smtp_pass` does not**: the running GoTrue
  picked up a `smtp_port` PATCH within seconds (observed 2026-10-23)
  while an `smtp_pass` change made hours earlier was still not in effect
  — the propagation bug is password-specific.
- While hosted `smtp_port` points at the sink, GoTrue's real auth emails
  are discarded (the sink doesn't deliver) — keep the window short.
- Captured passwords are in the log in the clear: mode-0600 file, delete
  it when done. Full cleanup: sink process, log, cert copies, ufw rule.
- **Result of the 2026-10-23 capture**: the running GoTrue presented a
  stale password (sha256 `85bad909…`) while the config store held a
  different, Maddy-valid one (sha256 `746d4e77…`) — every GoTrue send
  died at Maddy with 535, and GoTrue still answered the client HTTP 200
  ("check your email"), so failed sends are invisible from the browser.

## Operations

- Logs: `journalctl -u maddy` (delivery/bounces), `-u mail-relay` (one
  line per accepted send), `-u nginx` (TLS / relay front).
- **Submission capture is ON in production** (deployed with commit
  92e7ebb, 2026-10-25): every `:465` submission writes the raw SMTP
  transcript (headers + full body) to
  `/var/lib/mail-relay/captures/` (`SMTP_SUBMIT_CAPTURE_DIR`), mode 0600,
  owned by `mailrelay` — `sudo ls` / `sudo cat`. Filenames are
  `<ISO-timestamp>-<seq>.eml`. The unit has `--allow-read` and
  `--allow-write` for the dir (fixed 2026-10-26 — before that the
  capture/prune threw `NotCapable` and the log line never printed), and
  the deployed relay reconstructs captures CRLF-faithfully, so an empty
  body is visible as a trailing blank line (the relay's parse error for
  that shape is "no usable body part"). The capture also records
  whether the client ended the session before/after DATA (the
  early-DATA-termination discriminator from knowledge/platform/bugs.md).
  Newest captures first; pruned to the 20 most recent.
- The VPS needs **outbound** TCP 25 (provider-dependent — GCP blocks it;
  Hetzner-style unblock requests exist). Inbound 25 is never public
  (Maddy's listener is loopback-only). **Inbound 587 is public and, as
  of 2026-10-25, an open relay** (unauthenticated external submissions
  accepted and relayed, Oct 23–24 spam abuse observed) — see the
  open-relay entry in knowledge/platform/bugs.md.
- Bounces are logged, not delivered (no mailboxes).
- Cert renewal: certbot's timer renews `mail.juneau.love` automatically
  (webroot via nginx); no restart needed on either side.
