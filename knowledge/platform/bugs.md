---
type: project-notes
title: Bug list
description: Running log of real bugs found in the hosted Supabase project, the mail stack, and the site — with root cause, fix, and status. Newest first.
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-27T14:40:00Z }
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

### Approved guest can delete any approved user through the `guest_names` view (2026-10-26 → 2026-10-27)
The `public.guest_names` view is `SECURITY DEFINER` (`security_invoker = off`; required — it must escape `users`' own-row RLS for the gallery name join, [assets](../db/assets.md)). Supabase's hosted project sets **default privileges granting full table DML** (`arwdDxtm`) to `anon`, `authenticated`, and `service_role` on `public` objects, so the migration's explicit `grant select` adds to — not replaces — that grant surface. The view is auto-updatable, and DML through a definer view runs with the **owner's** privileges (bypassing `users` RLS) while triggers see `current_user` as the calling role. `guard_user_row` is `before insert or update` only, and `users` has no DELETE policy, so the unguarded path is DELETE: an approved guest can `delete from public.guest_names where id = <any approved user>` (e.g. `DELETE /rest/v1/guest_names?id=eq.…` with their own session) — the victim's `users` row is deleted **and cascades to `assets`** (account + all their images gone). Cross-row UPDATE is blocked (guard's catch-all deny), INSERT is blocked (NOT NULL `email` + view CHECK OPTION). Verified on the local stack (identical schema) 2026-10-26; the linked project held the same grants and trigger shape.
- **Fix (migration `20261027142007_guest_names_read_only`):** (1) `revoke all on public.guest_names from anon, authenticated` + re-pin `grant select … to authenticated` — pins the view's client surface to the documented read, so PostgREST 403s (PGRST301) any DML on it; (2) backstop `guard_user_delete` — a SECURITY INVOKER `before delete` trigger on `users` accepting only server-side roles (`postgres`, `service_role`, `supabase_auth_admin`), with `execute` revoked from client roles — so a future client DML grant on any definer view still cannot reach `users` rows.
- **Non-obvious:** a GoTrue admin delete (the supported way to remove a user) fires the guard as `current_user = postgres` even though GoTrue's session role is `supabase_auth_admin` — the `auth.users → users` RI cascade runs with the bootstrap superuser (verified 2026-10-27 with a temp logging trigger; `supabase_auth_admin` holds no direct DML on `users`). The accepted owner bypass therefore already covers user removal; `supabase_auth_admin` is allowed as resilience against a future GoTrue that deletes profile rows directly. Don't remove that branch — it would break every auth-user deletion.
- **Verified:** repro `e2e/approved-guest.spec.ts` ("guest_names view backstop") failed pre-fix (DELETE → 204, victim deleted) and passes post-fix (403, victim intact); full e2e suite green 2026-10-27. Residual: the hosted project needs the migration deployed (operator, post-merge).

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

### Prod gallery uploads dead: hosted functions presigned against the local dev stack (2026-10-25)
Every gallery upload by an approved guest failed with "The upload didn’t
go through. Please try again." while `asset-upload-url` returned 200 —
presigning *succeeded*, against the wrong endpoint. Two stacked defects,
both children of the 2026-10-24 poisoned secret batch (entry below):
- The hosted `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` still held the
  local CLI stack's default credentials, so even a correctly signed Hippius
  URL would have 403'd at the gateway (that was the failure mode all along
  the 10/24–10/25 uploads: right Hippius topology — `JL_ENV` was then unset
  —, default-credential signing).
- The fix command for that (2026-10-25 18:14/18:18Z) re-poisoned the project
  one variable at a time: `JL_ENV` (value `dev` — the local topology switch,
  evidently copied from the local env) was set on the hosted project in the
  same command as `S3_SECRET_ACCESS_KEY` (identical `updated_at`).
  `JL_ENV = "dev"` makes every function sign against
  `http://127.0.0.1:54321/storage/v1/s3` with region `local`, so each
  returned `upload_url` pointed at the *visitor's* localhost. The tell is
  the mixed fingerprint: a real `hip_…` access key in `X-Amz-Credential`
  alongside region `local` and a localhost host — one environment's
  credentials, another environment's topology.
- Fix: real Hippius keys as hosted secrets (18:14/18:18Z) +
  `supabase secrets unset JL_ENV` — prod leaves `JL_ENV` unset by design
  (unset = prod topology; [Supabase project](/project.md), Secrets). No
  redeploy: functions cold-boot per invocation, so the env change took
  effect on the next request.
- Lesson: a batch `secrets set` sourced from a local env re-leaks local
  values one variable at a time — even inside the command that fixes a
  leak. After any hosted secret write, read back
  `GET /v1/projects/{ref}/secrets` (names + `updated_at`) and diff against
  the prod list; `JL_ENV` is the first local value to look for.
- Verified (2026-10-25, production logs): `JL_ENV` gone from the hosted
  secret list (11 remain: the S3 pair, the mail-relay pair, and the
  built-in `SUPABASE_*`); two guest uploads completed end-to-end at 19:19
  and 19:20 UTC — `asset-upload-url` 200 → browser PUT to Hippius →
  `POST /rest/v1/assets` 201 (the row is inserted only after the PUT
  succeeds) → `asset-url` 200 on gallery reload.

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
- Residual (done 2026-10-25): the stale topology secrets (`SITE_URL`,
  `S3_ENDPOINT` / `S3_PATH_PREFIX` / `S3_REGION`, `S3_BUCKET`) are gone
  from the hosted project — the secret list now holds only the S3
  credential pair, the mail-relay pair, and the built-in `SUPABASE_*`
  (`S3_BUCKET` is still *read* from env, default `juneau-assets`).
- Verify: a fresh admin alert / approval email whose links open
  `https://juneau.love` (the 2026-10-24 registration retest covers this).
- Separate live risk (realized, resolved 2026-10-25 — see the uploads
  entry above): the re-stamped keys did hold the local CLI defaults; the
  real Hippius keys were set 18:14/18:18Z and live-verified
  (`supabase/tests/s3-presign.ts` round-trip against the Hippius gateway).
- Follow-up (owner request, still open): sweep the whole app for
  dev/local values that leaked into prod — code defaults, email templates,
  DNS. Function-secrets half done 2026-10-25: the full hosted list
  audited (S3 pair = real Hippius keys, fingerprint-verified; mail-relay
  pair live; the rest built-in `SUPABASE_*`).

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

### Duplicate confirmation email when the remote MX is slow (2026-10-26)
A guest who registers receives **two** confirmation emails ~10 s apart —
the first with a **dead token** (click → invalid/expired), the second the
working one. Observed twice 2026-10-26: the first real registration
(15:06 UTC, proton.me) and a repeat test (16:57 UTC, same recipient).
- Chain: GoTrue sends the confirmation email **synchronously** inside the
  signup transaction, and the relay's `:465` shim only answers 250 after
  the **remote MX** accepts DATA — Maddy's `:25` handoff is synchronous
  `deliver_to remote` (no queue). A slow MX (proton ~10 s) outlives the
  supabase.co stack's patience: the browser gets a 500 ~1 s into the
  request while the send is still in flight, GoTrue rolls the signup back
  (user row + token die), yet the mail still arrives. The register
  page's 10 s retry ([Client authentication](../api/client-auth.md), Flow 1)
  then creates a fresh signup with a fresh token → the second email.
- The relay is not duplicating: `captureSubmission` is a write-only
  diagnostic (`/var/lib/mail-relay/captures/`) that never feeds back into
  the send path. 16:57 evidence: exactly one `delivered` per `captured`,
  and the two captures are two distinct GoTrue submissions with different
  tokens (`620b33df…` vs `793fcd50…`).
- Not a client-timeout fix: the client has no timeout to raise (no
  `AbortController` in `src/` — fetch waits indefinitely). Back-computed
  from the db: attempt 2's `users` row `created_at 16:57:33.99` minus the
  10 s retry delay ⇒ attempt 1's 500 landed ≈ 16:57:23.9, seconds after
  the send started. The server gave up first.
- Not fixable on the Maddy side: queuing on `:25` would let GoTrue get
  its 250 instantly, but it would also swallow the umich-451 → 500 →
  client retry backstop (a 451 would surface asynchronously — signup
  commits with no mail, and the guest waits on Maddy's retry schedule;
  see the UMich WATCH entry below).
- Data integrity held: exactly one `users` row (from the surviving
  attempt), email confirmed with the second token; `notify-registration`
  is idempotent via `admin_notified_at`. The cost is one dead token in
  the inbox.
- Open diagnostic (dashboard only — owner): the GoTrue/Auth logs around
  16:57:24 UTC show why the supabase.co stack 500'd the slow send that
  fast (proxy vs GoTrue's own SMTP timeout). If it is a GoTrue SMTP
  timeout, the project's SMTP setting may have a knob to raise — the
  only fix that yields a single email.
- Candidate hardening (not for this case): a pre-retry
  `shouldCreateUser: false` probe would catch the *opposite* race (attempt
  1 committed but the client saw a 500). Here attempt 1 rolled back, so
  the probe 422s and the retry proceeds anyway. Caveat: the probe has a
  link-sending side effect for known emails
  ([Client authentication](../api/client-auth.md), Flow 1).
- Accepted for now: it requires a remote MX slow enough to outlive the
  proxy, and a working token always arrives within the 4 attempts.

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
