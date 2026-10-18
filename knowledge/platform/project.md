---
type: project-notes
title: Supabase project
description: The hosted Supabase project (ref, region, Data API exposure setting), the required dashboard settings, where secrets live, and the first-admin bootstrap.
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-18T20:33:20Z }
verified: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-18T23:15:00Z }
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

## Assets S3 (Hippius)

The gallery's image bytes live in a **private Hippius S3 bucket**
([assets](../db/assets.md) explains why not Supabase Storage):

| | |
|---|---|
| endpoint | `https://s3.hippius.com` — the only host; path-style addressing (`/bucket/key`) |
| region | `decentralized` (the value to sign with; `GetBucketLocation` returns `us-east-1`, but the client still signs `decentralized`) |
| bucket | `juneau-assets` — private (default policy, no public access; the key in the environment can do bucket-scoped ops, but account-level `ListBuckets` is 403) |
| credentials | Hippius access key (`hip_…` id) + secret, held only as edge-function secrets (see [Secrets](#secrets)) |

Hippius-specific SigV4 quirks (verified against the live gateway on
2026-10-18; encoded in [`_shared/s3.ts`](../../supabase/functions/_shared/s3.ts)
and covered by
[`supabase/tests/s3-presign.ts`](../../supabase/tests/s3-presign.ts)):

- The scope terminator is **`aws4_request`**, not AWS's standard
  `request` (Hippius' own SigV4 test suite uses it).
- Requests must carry a content hash: header-auth requests send
  `x-amz-content-sha256` (sha256 of the body, or `UNSIGNED-PAYLOAD`);
  presigned (query-auth) URLs carry
  `X-Amz-Content-Sha256=UNSIGNED-PAYLOAD` as a query parameter.
- Presigned URL expiry caps at **7 days**; the asset functions use 15
  minutes.
- **CORS is handled by the gateway**, not bucket config: any-origin
  preflight returns 204 with `Access-Control-Allow-Origin: *` (and
  `PutBucketCors` is unsupported), so the browser can follow presigned
  URLs and PUT straight from `juneau.love`.
- A presigned PUT's signed `Content-Type` is **not enforced**: a PUT
  with a different `Content-Type` also succeeds, and the type actually
  sent is what gets stored. The client sends the declared type; the
  [asset-url](../api/asset-url.md) function pins
  `response-content-type` from the DB row on every GET, so a drifted
  stored type degrades to a broken image, not a wrong type served.
- `DeleteBucketPolicy` and multipart upload are unsupported.

## Required dashboard settings (not in migrations)

Per [Client authentication](../api/client-auth.md):

- Auth: **email confirmation enabled** (the confirmation link is step 1
  of initial login).
- Auth: **passwordless email login enabled for the email provider** —
  the passwordless magiclink design depends on it (no passwords exist at
  all). There is no CLI/local toggle for this; it is a dashboard
  setting only (see [Local development](#local-development-differs-from-hosted)).
- Auth: JWT expiry **1 day** (86400s), refresh token expiry **365 days**
  (the GoTrue maximum).
- Edge functions: `send-login-link` **publicly invokable** (called with
  no JWT — locally via `[functions.send-login-link] verify_jwt = false`
  in `supabase/config.toml`, on deploy via `--no-verify-jwt`);
  `registration-decision` requires an authenticated caller (it re-verifies
  admin itself). There is **no login edge function** — the login link is
  exchanged client-side.
- Transactional email provider: **Resend** (the free tier covers a
  wedding's volume). It serves both Supabase's auth emails (confirmation
  link, via the project's email/SMTP settings) and the edge functions'
  login-link emails (function secrets `RESEND_API_KEY` + `EMAIL_FROM`).
  Locally, without `RESEND_API_KEY`, `send-login-link` prints the link to
  the function log and counts as sent (dev mode); `registration-decision`
  reports `email_sent: false`.

## Secrets

| Secret | Where it lives | Never |
|---|---|---|
| Management API token | `$SUPABASE_ACCESS_KEY` env; passed as `SUPABASE_ACCESS_TOKEN` | repo, config.toml, client env |
| DB password | env (`SUPABASE_DB_PASSWORD`), set in dashboard | repo, client env |
| service role key | edge functions only (secrets) | client bundle, repo |
| Resend API key | `RESEND_API_KEY` edge function secret | repo, client env |
| Email sender | `EMAIL_FROM` edge function secret (verified Resend sender) | repo, client env |
| S3 access key id | `S3_ACCESS_KEY_ID` edge function secret (Hippius, [Assets S3](#assets-s3-hippius)) | repo, client env |
| S3 secret access key | `S3_SECRET_ACCESS_KEY` edge function secret | repo, client env |
| S3 bucket name | `S3_BUCKET` edge function secret (`juneau-assets`) | repo, client env |
| anon key | public by design (RLS is the boundary); also the `SUPABASE_ANON_KEY` edge function secret the asset functions use to call PostgREST as the user | — it ships in the browser bundle anyway |

## First-admin bootstrap

No UI or API path grants admin — see the steps in
[users](../db/users.md) (Access patterns). The admin's first login link
comes from the normal sign-in page.

## Local development (differs from hosted)

Verified against the local Supabase CLI stack (GoTrue v2.197.0,
2026-10-18):

- **Email autoconfirm is on locally** (`GOTRUE_MAILER_AUTOCONFIRM=true`) —
  API signups are confirmed immediately, so the confirmation-link path
  cannot be exercised locally. Hosted keeps confirmation enabled.
- **The local CLI exposes no passwordless toggle**: `POST /auth/v1/signup`
  without a password fails with `Signup requires a valid password`, and
  `generate_link` with `type: "signup"` fails the same way. Hosted
  passwordless signup is what the real registration path uses (see
  [Required dashboard settings](#required-dashboard-settings-not-in-migrations)).
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

# edge functions (secrets first; send-login-link is public):
supabase secrets set RESEND_API_KEY=<key> EMAIL_FROM='juneau.love <notify@juneau.love>'
supabase secrets set S3_BUCKET=juneau-assets S3_ACCESS_KEY_ID=<hip_…> S3_SECRET_ACCESS_KEY=<key> SUPABASE_ANON_KEY=<anon key>
supabase functions deploy send-login-link --no-verify-jwt
supabase functions deploy registration-decision
supabase functions deploy asset-url
supabase functions deploy asset-upload-url
```

Never run `supabase db reset --linked` — it drops user data.
