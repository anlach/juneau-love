---
type: db-table
title: permissions
description: Named RBAC permissions, namespaced as area:action. Seeded with the three registrations permissions; all three belong to the admin role in v1.
status: stable
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-18T03:44:05Z }
---

# permissions

The RBAC permission catalog. Permissions are the fine-grained capabilities
the FE checks to gate UI (e.g. the registrations page requires
`registrations:read`); roles bundle them via
[role_permissions](/role_permissions.md).

# Schema

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` PK DEFAULT `gen_random_uuid()` | |
| `name` | `text` NOT NULL UNIQUE | Namespaced key `area:action`, e.g. `registrations:read`. |
| `description` | `text` | Human-readable. |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

Target DDL and seed:

```sql
create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

insert into public.permissions (name, description) values
  ('registrations:read',    'View the list of all registrations and their approval state.'),
  ('registrations:approve', 'Approve a registration (grants the guest role).'),
  ('registrations:reject',  'Reject a registration (revokes the guest role).')
  on conflict (name) do nothing;
```

Shipped in `supabase/migrations/20261018033502_initial_schema.sql` (seed
is idempotent via `on conflict (name) do nothing`). No indexes beyond the
PK and the unique index on `name` — a three-row catalog.

# Access patterns

- **Read:** any signed-in user may list permissions (names are not
  sensitive). The FE resolves the *current* user's effective set through
  the [user_permissions](/user_permissions.md) view and builds a
  `can('registrations:read')`-style helper for UI gating.
- **Write:** never from the client (no DML policies). Rows are seeded by
  migration.
- **Naming convention:** `area:action`. Add new permissions per area
  (e.g. future `rsvp:create`) rather than broad catch-alls.
- **v1 gap to note:** the `guest` role has **no** permissions in v1.
  Guest-facing access is gated on approval state (see [Access by approval
  status](../stories/access-by-approval-status.md)); permissions exist
  today only to express admin capabilities. Future guest features should
  get real permissions.

# RLS

```sql
create policy "permissions_read" on public.permissions
  for select to authenticated
  using (true);
```

No INSERT/UPDATE/DELETE policies.

**Data API grants** (shipped): `service_role` — all four; `authenticated`
— `select`; `anon` — `select` only (zero rows, no anon policy).
