---
type: project-notes
title: Supabase project
description: The hosted Supabase project (ref, region, Data API exposure setting), the required dashboard settings, where secrets live, and the first-admin bootstrap.
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-18T16:59:45Z }
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

## Required dashboard settings (not in migrations)

Per [Client authentication](../api/client-auth.md):

- Auth: **email confirmation enabled** (the confirmation link is step 1
  of initial login).
- Auth: JWT expiry **1 day** (86400s), refresh token expiry **365 days**
  (the GoTrue maximum).
- Edge functions: `send-login-link` **publicly invokable** (called with
  no JWT); `registration-decision` requires an authenticated caller (it
  re-verifies admin itself). There is **no login edge function** — the
  login link is exchanged client-side.
- Transactional email provider: **TBD** (Resend suggested; the free tier
  covers a wedding's volume). It serves both Supabase's auth emails
  (confirmation link, via the project's email/SMTP settings) and the
  edge functions' login-link emails.

## Secrets

| Secret | Where it lives | Never |
|---|---|---|
| Management API token | `$SUPABASE_ACCESS_KEY` env; passed as `SUPABASE_ACCESS_TOKEN` | repo, config.toml, client env |
| DB password | env (`SUPABASE_DB_PASSWORD`), set in dashboard | repo, client env |
| service role key | edge functions only (secrets) | client bundle, repo |
| anon key | public by design (RLS is the boundary) | — it ships in the browser bundle anyway |

## First-admin bootstrap

No UI or API path grants admin — see the steps in
[users](../db/users.md) (Access patterns). The admin's first login link
comes from the normal sign-in page.

## Deploy

```sh
# one-time: export SUPABASE_ACCESS_TOKEN="$SUPABASE_ACCESS_KEY"
#           supabase link --project-ref asuupanisvfxvbmdpcxt
export SUPABASE_DB_PASSWORD='<postgres password>'
supabase db push        # applies new migrations as postgres (owner bypass)
supabase db advisors    # RLS / schema health check after changes
```

Never run `supabase db reset --linked` — it drops user data.
