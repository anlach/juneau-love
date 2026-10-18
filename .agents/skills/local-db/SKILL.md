---
name: local-db
description: >
  Connect to and manage the local Supabase Postgres container (supabase-db)
  for juneau-love dev. Use when running psql or SQL scripts against the
  local database, applying migrations with the supabase CLI, or when the
  local db is down/missing and needs to be (re)started. Triggers: local db,
  local database, localhost:54322, psql, db push, supabase-db container.
---

# Local database

The local dev DB is the `supabase-db` container: the real Supabase Postgres
image (has the `auth` schema, `auth.uid()`, and the `anon` /
`authenticated` / `service_role` roles). No GoTrue, PostgREST, or other
stack services run — database-level work only.

## Connecting

- Host `127.0.0.1`, port `54322`, user `postgres`, database `postgres`
- Password: `your-super-secret-and-long-postgres-password`
  (the official Supabase local-dev default)

```bash
PGPASSWORD='your-super-secret-and-long-postgres-password' \
  psql -h 127.0.0.1 -p 54322 -U postgres -d postgres
```

`psql` needs no sudo. The user is **not** in the `docker` group, so all
`docker` commands need `sudo`.

Supabase CLI connection string (must be run from the repo root):

```
postgresql://postgres:your-super-secret-and-long-postgres-password@127.0.0.1:54322/postgres
```

## If the container is not running

```bash
sudo docker run -d --name supabase-db \
  -e POSTGRES_PASSWORD='your-super-secret-and-long-postgres-password' \
  -e POSTGRES_DB=postgres \
  -e JWT_EXP=3600 \
  -p 127.0.0.1:54322:5432 \
  supabase/postgres:17.11.0.004
```

For a fresh database: `sudo docker rm -f supabase-db` first, then run.
First start takes ~10–30s to initialize the Supabase schemas; retry
connects if they fail with `connection refused` or `starting up`.

## Required before `db push` (and after any container recreation)

The image's GoTrue stub names the confirmation column `confirmed_at`, but
the migration (and the hosted project) use `auth.users.email_confirmed_at`.
Also, the tables are owned by `supabase_auth_admin` and `postgres` is NOT a
superuser in this image, so the column must be added as `supabase_admin`
(superuser, same password). Idempotent — run it, then `db push`:

```bash
PGPASSWORD='your-super-secret-and-long-postgres-password' \
  psql -h 127.0.0.1 -p 54322 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 <<'SQL'
alter table auth.users add column if not exists email_confirmed_at timestamptz;
grant references on auth.users to postgres;
SQL
```

`postgres` already holds TRIGGER/INSERT on `auth.users`, so the migration's
`on_auth_user_created` / `on_auth_email_confirmed` triggers apply fine
after this. No GoTrue runs locally, so the column stays NULL — set
`public.users.email_confirmed_at` by hand to exercise the verified path.

## Applying migrations

```bash
npx -y supabase db push \
  --db-url "postgresql://postgres:your-super-secret-and-long-postgres-password@127.0.0.1:54322/postgres"
```

Records history in `supabase_migrations.schema_migrations`; re-runs skip
applied migrations. `seed.sql` is not applied by `db push` — run it with
`psql` when local dev data is wanted.
