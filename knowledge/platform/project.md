---
type: project-notes
title: Supabase project
description: The hosted Supabase project (ref, region, Data API exposure setting), the required dashboard settings, where secrets live, and the first-admin bootstrap.
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-22T04:32:01Z }
verified:
  - { by: pi/Qwen3.8-27B-TEE, at: 2026-10-20T07:14:32Z }
  - { by: pi/Qwen3.8-27B-TEE, at: 2026-10-22T04:32:01Z }
---

# Supabase project

Cross-cutting notes for the hosted Supabase project. Per-table details
live in the [db bundle](../db/); per-function details in the
[api bundle](../api/).

## Project

| | |
|---|---|
| ref | `asuupanisvfxvbmdpcxt` |
| name | anlach's Project |
| region | us-west-2 |
| created | 2026-10-17 |
| Data API exposure | New tables in `public` are **not** auto-exposed to PostgREST (opt-out became the default for projects created after 2026-05-30) — the explicit `GRANT`s in the [db bundle](../db/) are mandatory, not cosmetic |

The schema is designed in the [db bundle](../db/) and implemented as
`supabase/migrations/` (Supabase CLI, imperative migrations).
`supabase/seed.sql` is local-dev data only — never applied to the hosted
project. `.env.example` documents the client env:
`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`.

## Assets S3 (Hippius, local stack)

The gallery's image bytes live in a **private `juneau-assets` bucket**
([assets](../db/assets.md) explains why not Supabase Storage). Hosted
traffic uses Hippius S3; the local CLI stack serves the **same S3
protocol** out of its storage container, so local dev exercises the real
asset flow without Hippius credentials:

| | Hippius (hosted) | Local stack |
|---|---|---|
| endpoint | `https://s3.hippius.com` | `http://127.0.0.1:54321` (origin) |
| path prefix | — (bucket at `/`) | `/storage/v1/s3` — objects live at `/storage/v1/s3/<bucket>/<key>`, and the prefix is part of the **signed** canonical path (see `S3_PATH_PREFIX` in [`_shared/s3.ts`](../../supabase/functions/_shared/s3.ts)) |
| region | `decentralized` (the value to sign with; `GetBucketLocation` returns `us-east-1`, but the client still signs `decentralized`) | `local` |
| bucket | `juneau-assets` — private (default policy, no public access; the key in the environment can do bucket-scoped ops, but account-level `ListBuckets` is 403) | `juneau-assets` — a storage bucket that must be created per stack (it survives normal restarts but not `supabase db reset`; see [Local development](#local-development-differs-from-hosted)) |
| credentials | Hippius access key (`hip_…` id) + secret, held only as edge-function secrets (see [Secrets](#secrets)) | the CLI's built-in local-stack defaults (stable constants, printed by `supabase status`) — committed in `supabase/config.toml` `[edge_runtime.secrets]`, not secrets |

SigV4 quirks shared by **both** endpoints (verified against the live
Hippius gateway on 2026-10-18 and against local storage-api v1.82.1 on
2026-10-20; encoded in
[`_shared/s3.ts`](../../supabase/functions/_shared/s3.ts) and covered by
[`supabase/tests/s3-presign.ts`](../../supabase/tests/s3-presign.ts), whose
live round-trip works against either):

- The scope terminator is **`aws4_request`**, not AWS's standard
  `request` (Hippius' own SigV4 test suite uses it; the local
  storage-api signs with it too).
- Requests must carry a content hash: header-auth requests send
  `x-amz-content-sha256` (sha256 of the body, or `UNSIGNED-PAYLOAD`);
  presigned (query-auth) URLs carry
  `X-Amz-Content-Sha256=UNSIGNED-PAYLOAD` as a query parameter.

Hippius-specific behaviour (does **not** apply to the local stack):

- Presigned URL expiry caps at **7 days**; the asset functions use 15
  minutes.
- **CORS is handled by the gateway**, not bucket config: any-origin
  preflight returns 204 with `Access-Control-Allow-Origin: *` (and
  `PutBucketCors` is unsupported), so the browser can follow presigned
  URLs and PUT straight from `juneau.love`. (Local: preflight returns
  200 with the same `*` origin.)
- A presigned PUT's signed `Content-Type` is **not enforced**: a PUT
  with a different `Content-Type` also succeeds, and the type actually
  sent is what gets stored. The client sends the declared type; the
  [asset-url](../api/asset-url.md) function pins
  `response-content-type` from the DB row on every GET, so a drifted
  stored type degrades to a broken image, not a wrong type served.
  (Local: a `Content-Type` mismatch fails SigV4 verification with 403 —
  the signed header is enforced by the signature itself.)
- `DeleteBucketPolicy` and multipart upload are unsupported.

## Required dashboard settings (not in migrations)

Per [Client authentication](../api/client-auth.md):

- Auth: **email confirmation enabled** (the confirmation link is step 1
  of initial login).
- Auth: **no toggle needed for passwordless magiclink** — GoTrue's
  magic-link endpoint is on by default (`External.Email.MagicLinkEnabled`,
  `default:"true"` in the GoTrue v2.197.0 source; the hosted
  `config/auth` API exposes no field for it, so it cannot be turned off
  from the dashboard — the old "passwordless login" toggle no longer
  exists; verified live 2026-10-22). The admin `generate_link` path
  (login links) has no such gate at all.
- Auth: JWT expiry **1 day** (86400s), refresh token expiry **365 days**
  (the GoTrue maximum).
- Edge functions: `send-login-link` and `notify-registration`
  **publicly invokable** (called with no JWT — locally via
  `[functions.<name>] verify_jwt = false` in `supabase/config.toml`, on
  deploy via `--no-verify-jwt`); `registration-decision` requires an
  authenticated caller (it re-verifies admin itself). There is **no
  login edge function** — the login link is exchanged client-side.
- Transactional email: **self-hosted Maddy on the VPS** (a wedding's
  volume; no third-party provider). GoTrue's auth emails (confirmation
  link, signup) go to Maddy's `:587` submission port via Supabase's
  **custom SMTP** setting; the edge functions' emails go to Maddy through
  a small HTTP→SMTP relay (the edge runtime can't open raw TCP). All of
  it — topology, DNS, secrets, the Management API call — is in
  [Mail (self-hosted Maddy)](/mail.md); the install runbook is
  `infra/mail/README.md`.
  Locally, without `MAIL_RELAY_URL`/`MAIL_RELAY_TOKEN`, both public
  functions print the email to the function log and count as sent (dev
  mode); `registration-decision` reports `email_sent: false`.

## Secrets

| Secret | Where it lives | Never |
|---|---|---|
| Management API token | `$SUPABASE_ACCESS_KEY` env; passed as `SUPABASE_ACCESS_TOKEN` | repo, config.toml, client env |
| DB password | env (`SUPABASE_DB_PASSWORD`), set in dashboard | repo, client env |
| service role key | edge functions only (secrets) | client bundle, repo |
| Mail relay URL | `MAIL_RELAY_URL` edge function secret (`https://mail.juneau.love` — not a secret, but kept with the token so deploy is one command) | repo, client env |
| Mail relay token | `MAIL_RELAY_TOKEN` edge function secret; same value on the VPS in `/etc/mail-relay/env` | repo, client env |
| Maddy submission password (GoTrue) | plaintext only in the Supabase project SMTP setting; on the VPS only as the hash in `/etc/maddy/smtp_passwd` | repo, client env |
| S3 access key id | hosted: `S3_ACCESS_KEY_ID` edge function secret (Hippius, [Assets S3](#assets-s3-hippius-local-stack)); local: `config.toml` (CLI default, not a secret) | client env |
| S3 secret access key | hosted: `S3_SECRET_ACCESS_KEY` edge function secret; local: `config.toml` | client env |
| S3 bucket name | `S3_BUCKET` edge function secret (`juneau-assets`) | repo, client env |
| anon key | public by design (RLS is the boundary); also the `SUPABASE_ANON_KEY` edge function secret the asset functions use to call PostgREST as the user | — it ships in the browser bundle anyway |

## First-admin bootstrap

No UI or API path grants admin — see the steps in
[users](../db/users.md) (Access patterns). The admin's first login link
comes from the normal sign-in page.

## Local development (differs from hosted)

Verified against the local Supabase CLI stack (GoTrue v2.197.0,
2026-10-18):

- **New edge functions are invisible to the local runtime until the
  stack restarts.** The edge-runtime container gets its function
  registry from the `SUPABASE_INTERNAL_FUNCTIONS_CONFIG` env var,
  snapshotted at `supabase start` — the `supabase/functions` directory is
  bind-mounted, but nothing re-reads it. A function added after the last
  start 404s with "Function not found" (seen with `asset-url` /
  `asset-upload-url`). Fix: `supabase stop && supabase start` (data
  persists in the volume). In the current CLI, `functions deploy` is
  hosted-only — it demands an access token even with a local stack
  running. If the CLI is unavailable and you recreate the
  `supabase_edge_runtime_*` container by hand (`docker create` with the
  env from the old container plus the updated
  `SUPABASE_INTERNAL_FUNCTIONS_CONFIG` JSON), it also needs the
  CLI-injected bootstrap file `/root/index.ts` (not in the image) —
  without it the worker exits with `failed to bootstrap runtime: could
  not find an appropriate entrypoint`. Recover it from a healthy stack
  or an old shell log and `docker cp` it in.
- **Function env lives in `[edge_runtime.secrets]`** in
  `supabase/config.toml` — exposed to every local edge function as a
  container env var. (CLI 2.121+ rejects `[functions.<name>.env]` tables:
  `supabase start` fails with `invalid keys: env`. The section name says
  secrets, but plain local-dev values work fine — the local S3 config
  lives there, below.) Set `SITE_URL = "http://localhost:3000"`, matching
  `[auth] site_url` — the functions-config and secrets are snapshotted
  into the runtime at `supabase start`, so restart after changing them.
  Without it, functions fall back to the `https://juneau.love` default,
  and GoTrue's `generate_link` **silently rewrites any `redirect_to`
  whose origin doesn't match its configured `site_url` to the bare
  configured site URL** — magic links then land on `/` instead of
  `/login` (verified 2026-10-20, GoTrue v2.197.0: mismatched origin
  rewritten, same-origin paths preserved). On the hosted project the
  dashboard `site_url` must be `https://juneau.love` — at first deploy it
  was `http://localhost:3000` (a copy of the local value), so GoTrue would
  have silently rewritten every magic link to localhost; it is set via the
  same `PATCH /config/auth` as the SMTP config
  ([Mail (self-hosted Maddy)](/mail.md), verified live 2026-10-22).
- **The local asset flow uses the local stack's S3 protocol** — the
  asset functions run unchanged against
  `http://127.0.0.1:54321/storage/v1/s3` instead of Hippius (see
  [Assets S3](#assets-s3-hippius-local-stack)). `config.toml`
  `[edge_runtime.secrets]` carries the `S3_*` values (endpoint, path
  prefix, region, bucket, CLI-default credentials). The `juneau-assets`
  storage bucket must exist in local storage — create it once after a
  fresh `supabase start` or `supabase db reset` (service role from
  `supabase status --output env`):

  ```sh
  curl -sS -X POST http://127.0.0.1:54321/storage/v1/bucket \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H 'Content-Type: application/json' \
    -d '{"id":"juneau-assets","name":"juneau-assets","private":true}'
  ```
- **Email autoconfirm is on locally** (`GOTRUE_MAILER_AUTOCONFIRM=true`) —
  API signups are confirmed immediately, so the confirmation-link path
  cannot be exercised locally. Hosted keeps confirmation enabled.
- **`/signup` demands a password, locally and hosted**: `POST
  /auth/v1/signup` without a password fails with `Signup requires a
  valid password` (the hosted project runs the same GoTrue code — there
  is no dashboard toggle that changes this), and `generate_link` with
  `type: "signup"` fails the same way. The client therefore registers
  through the magic-link endpoint (`POST /auth/v1/otp`; see [Client
  authentication](../api/client-auth.md) Flow 1), which works locally too
  — with local autoconfirm the signup arrives confirmed, so the
  confirmation-link path itself still can't be exercised locally.
- **Raw `auth.users` inserts** (used by [seed.sql](../../supabase/seed.sql)
  and the flow test to stand in for hosted passwordless signups) must
  mimic what GoTrue writes on a real signup or GoTrue admin calls 500:
  - `instance_id = '00000000-0000-0000-0000-000000000000'`,
    `aud = role = 'authenticated'` — GoTrue's user lookup filters on
    `instance_id` + `aud` + `is_sso_user` (none of these have column
    defaults); a user it can't find is re-created, which 500s with a
    duplicate-key error.
  - The token columns (`confirmation_token`, `recovery_token`,
    `email_change_token_new`, `email_change`) have **no DB defaults** and
    GoTrue scans them into non-null strings — they must be `''`, not
    NULL (a NULL 500s with a scan error).
  - An `auth.identities` row (provider `email`, `identity_data` with
    `sub`/`email`/`email_verified`) — some GoTrue paths resolve users via
    the identity row. Its `email` column is generated and must not be
    written.
  - `auth.users.confirmed_at` is a **generated column**
    (`LEAST(email_confirmed_at, phone_confirmed_at)`) — set
    `email_confirmed_at`, never `confirmed_at`.
- `supabase/tests/flows.sh` is the end-to-end flow test (register →
  confirm → approve → link → click → guest content → reject → guard
  negatives) against the local stack; it runs `supabase db reset` first
  and restores the seed state.

## Deploy

```sh
# one-time: export SUPABASE_ACCESS_TOKEN="$SUPABASE_ACCESS_KEY"
#           supabase link --project-ref asuupanisvfxvbmdpcxt
export SUPABASE_DB_PASSWORD='<postgres password>'
supabase db push        # applies new migrations as postgres (owner bypass)
supabase db advisors    # RLS / schema health check after changes

# edge functions (secrets first; send-login-link and
# notify-registration are public — --no-verify-jwt persists that):
supabase secrets set MAIL_RELAY_URL='https://mail.juneau.love' MAIL_RELAY_TOKEN='<token>'
supabase secrets set S3_BUCKET=juneau-assets S3_ACCESS_KEY_ID=<hip_…> S3_SECRET_ACCESS_KEY=<key> SUPABASE_ANON_KEY=<anon key>
supabase functions deploy send-login-link --no-verify-jwt
supabase functions deploy notify-registration --no-verify-jwt
supabase functions deploy registration-decision
supabase functions deploy asset-url
supabase functions deploy asset-upload-url
```

Never run `supabase db reset --linked` — it drops user data.
