---
type: db-table
title: roles
description: Named RBAC roles. Seeded with admin and guest; the guest role is granted and revoked automatically by registration approval, the admin role is assigned only out-of-band.
status: stable
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-18T03:44:05Z }
---

# roles

The RBAC role catalog. A user's capabilities come from their roles via
[user_roles](/user_roles.md) and [role_permissions](/role_permissions.md);
the FE fetches the current user's roles/permissions to gate the UI, and RLS
enforces the same at the data level.

# Schema

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` PK DEFAULT `gen_random_uuid()` | |
| `name` | `text` NOT NULL UNIQUE | Role key used by code and RLS: `admin`, `guest`. |
| `description` | `text` | Human-readable, shown nowhere in v1. |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

Target DDL and seed:

```sql
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

insert into public.roles (name, description) values
  ('admin', 'Site administrator: reviews and manages registrations.'),
  ('guest', 'Approved wedding guest with access to guest content.')
  on conflict (name) do nothing;
```

Shipped in `supabase/migrations/20261018033502_initial_schema.sql` (seed
is idempotent via `on conflict (name) do nothing`). No indexes beyond the
PK and the unique index on `name` — a two-row catalog.

# Access patterns

- **Read:** any signed-in user may list roles (names are not sensitive);
  the FE uses this only indirectly, via its own [user_roles](/user_roles.md)
  rows and the `public.has_role(...)` helper in RLS.
- **Write:** never from the client (no DML policies). Role *rows* are
  seeded by migration; role *assignments* happen two ways:
  - `guest` — automatically by the status-sync trigger on [users](/users.md)
    (granted on approve, revoked on reject).
  - `admin` — out-of-band bootstrap only (see the bootstrap steps in
    [users](/users.md)). No UI or API path grants admin in v1.
- **Adding a role later** (e.g. `planner`): migration inserts the row and
  seeds [role_permissions](/role_permissions.md) entries. Code that checks
  a role does so by `name`, so nothing else changes.

# RLS

```sql
create policy "roles_read" on public.roles
  for select to authenticated
  using (true);
```

No INSERT/UPDATE/DELETE policies. RLS is not forced (owner can manage
catalog rows via migrations).

**Data API grants** (shipped): `service_role` — all four; `authenticated`
— `select`; `anon` — `select` only (zero rows, no anon policy).
