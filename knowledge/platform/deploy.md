---
type: deploy-notes
title: Supabase hosted project + deploy workflow
description: "The hosted Supabase project (ref, region, Data API exposure setting), how the repo's migrations are deployed with the CLI, the required tokens/env vars, one-time auth settings, and the first-admin bootstrap. Draft until the first push is verified."
status: draft
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-18T03:44:05Z }
---

# Supabase hosted project + deploy workflow

Cross-cutting implementation notes for the hosted Supabase project:
what it is, how `supabase/migrations/` reaches it, and what must be set
outside of migrations. Per-table details live in [the db bundle](../db/).

## Project

| | |
|---|---|
| ref | `asuupanisvfxvbmdpcxt` |
| name | anlach's Project |
| region | us-west-2 |
| created | 2026-10-17 |
| Data API exposure | New tables in `public` are **not** auto-exposed (project created after 2026-05-30, the opt-out became default for new projects) — migrations must carry explicit `GRANT`s |

## Repo layout (standard Supabase CLI, imperative migrations)

- `supabase/config.toml` — local dev config (`project_id = "juneau-love"`).
- `supabase/migrations/` — the schema, in order. Initial migration:
  `20261018033502_initial_schema.sql` (tables, triggers, helper functions,
  views, RLS, grants, RBAC seed — see the [db bundle](../db/)).
- `supabase/seed.sql` — **local-only** dev data (local admin/guest/pending
  users). Never applied to the hosted project (`db push` ignores it; it
  runs on `supabase db reset` locally).
- `.env.example` — client env: `PUBLIC_SUPABASE_URL`,
  `PUBLIC_SUPABASE_ANON_KEY`.

## Deploy workflow

Prereqs: Supabase CLI (`mise use -g supabase-cli/supabase`),
`$SUPABASE_ACCESS_KEY` (Management API personal access token — env only,
never committed), and the project's DB password (dashboard → Project
Settings → Database).

```sh
# one-time: link this repo to the hosted project
export SUPABASE_ACCESS_TOKEN="$SUPABASE_ACCESS_KEY"
supabase link --project-ref asuupanisvfxvbmdpcxt

# every deploy: apply new migrations (tracked in
# supabase_migrations.schema_migrations; only new files run)
export SUPABASE_DB_PASSWORD='<postgres password>'
supabase db push
supabase db advisors   # RLS / schema health check after changes
```

Notes:

- `db push` connects to the hosted database **directly as `postgres`**
  (that is why the migrations rely on the accepted owner bypass), which is
  why it needs the DB password in addition to the Management API token.
- Never run `supabase db reset --linked` — it drops user data.
- Add migrations with `supabase migration new <name>`; update `knowledge/db`
  in the same commit.

## One-time settings (dashboard, not in migrations)

Per [Client authentication](../api/client-auth.md) — verify on the hosted
project before first use:

- Auth: email confirmation **enabled** (step 1 of initial login).
- Auth: JWT expiry **1 day**, refresh token expiry **365 days**.
- Edge functions `login-with-passcode` / `send-login-link`: publicly
  invokable; `registration-decision`: authenticated. (Functions not yet
  written.)
- Transactional email provider: **TBD** (Resend suggested).

## Secrets

| Secret | Where it lives | Never |
|---|---|---|
| Management API token | `$SUPABASE_ACCESS_KEY` env; passed as `SUPABASE_ACCESS_TOKEN` | repo, config.toml, client env |
| DB password | env (`SUPABASE_DB_PASSWORD`), set in dashboard | repo, client env |
| service role key | edge functions only (secrets) | client bundle, repo |
| anon key | public by design (RLS is the boundary) | — it ships in the browser bundle anyway |

## First-admin bootstrap (out-of-band)

No UI or API path grants admin. Steps (also in
[users](../db/users.md#access-patterns)): create the auth user in the
dashboard (the trigger creates a `pending` row) → approve the row in the
SQL editor → insert the `(user, admin)` role row. The admin's first login
link comes from the normal sign-in page.

## Verification after first push

- `supabase db advisors` (CLI ≥ 2.81.3) reports no RLS gaps.
- `select version();` — confirm the hosted Postgres major version and keep
  `supabase/config.toml [db] major_version` in sync.
- As `postgres` in the SQL editor: `select relname, relrowsecurity from
  pg_class where relnamespace = 'public'::regnamespace` — every table RLS
  enabled, views not.
- Spot-check a denied read: as an unauthenticated caller, `select` on
  `login_passcodes` returns zero rows (grant + no policies), and `anon`
  gets zero rows on every table.
