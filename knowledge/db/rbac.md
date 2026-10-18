---
type: db-schema
title: RBAC (roles, permissions, grants)
description: The access-control catalog — roles, permissions, and the join tables assigning them — plus the user_permissions view the FE queries to gate the UI. In v1 permissions express admin capabilities only; guest content is gated on approval state, not permissions.
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-18T16:59:45Z }
---

# RBAC (roles, permissions, grants)

Role-based access control: roles bundle permissions, users hold roles, and
a user's effective permissions are the union over their roles. Two things
ride on it:

- **Admin capabilities** — the registrations page and its actions are
  gated on the `registrations:*` permissions ([Review
  registrations](../stories/review-registrations.md)).
- **The guest role** — granted/revoked automatically by registration
  approval (the status-sync trigger on [users](/users.md)). It holds **no
  permissions** in v1: guest *content* access is keyed on
  `status = 'approved'`, not permissions ([Access by approval
  status](../stories/access-by-approval-status.md)). Future guest features
  should get real permissions.

# Schema

| Table | Columns | Seeded with |
|---|---|---|
| `roles` | `id uuid PK default gen_random_uuid()`, `name text not null unique`, `description text`, `created_at timestamptz not null default now()` | `admin`, `guest` |
| `permissions` | `id uuid PK default gen_random_uuid()`, `name text not null unique`, `description text`, `created_at timestamptz not null default now()` | `registrations:read`, `registrations:approve`, `registrations:reject` |
| `role_permissions` | `role_id uuid not null ref roles(id) on delete cascade`, `permission_id uuid not null ref permissions(id) on delete cascade`, `PK (role_id, permission_id)` | admin ← all three permissions; guest ← none |
| `user_roles` | `user_id uuid not null ref users(id) on delete cascade`, `role_id uuid not null ref roles(id) on delete cascade`, `assigned_at timestamptz not null default now()`, `PK (user_id, role_id)` | — |

Permission names are namespaced `area:action`; add new permissions per
area (e.g. a future `rsvp:create`), never broad catch-alls.

Seed DDL (idempotent, `on conflict do nothing`):

```sql
insert into public.roles (name, description) values
  ('admin', 'Site administrator: reviews and manages registrations.'),
  ('guest', 'Approved wedding guest with access to guest content.')
on conflict (name) do nothing;

insert into public.permissions (name, description) values
  ('registrations:read',    'View the list of all registrations and their approval state.'),
  ('registrations:approve', 'Approve a registration (grants the guest role).'),
  ('registrations:reject',  'Reject a registration (revokes the guest role).')
on conflict (name) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.name = 'admin'
on conflict do nothing;
```

## user_permissions view

```sql
create view public.user_permissions with (security_invoker = true) as
select ur.user_id,
       p.name as permission
from public.user_roles ur
join public.role_permissions rp on rp.role_id = ur.role_id
join public.permissions p       on p.id = rp.permission_id;
```

Flattens the joins to one row per (user, permission) — the single query
the FE uses to build the current user's permission set ([Current user
state](../api/current-user-state.md)). `security_invoker = true` (PG 15+)
means the base tables' RLS filters the result — a user only ever sees
their own rows; the view has no RLS of its own.

**Admin nuance:** the admin's `user_roles` SELECT covers *all* users, so
an admin querying the view can enumerate any user's effective
permissions. Intended (useful on the registrations page); do not widen
this further.

Indexes: the composite PKs already cover the `user_id`-leading and
`role_id`-leading lookups the policies and helpers use.
`user_roles.role_id` and `role_permissions.permission_id` are
intentionally unindexed — both catalogs are tiny and never deleted in v1.

## Helper functions

Both are `SECURITY DEFINER` (so RLS policies do not recurse into these
tables' own RLS) and both check `auth.uid()`:

- `public.has_role(role_name text)` — current user holds a role by name.
  Defined and documented in [users](/users.md) (the first policy that uses
  it lives there).
- `public.has_role_id(role_id uuid)` — current user holds a role by id
  (used by the `role_permissions` policy):

```sql
create or replace function public.has_role_id(role_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role_id = has_role_id.role_id
  );
$$;
```

(The parameter is referenced as `has_role_id.role_id` to disambiguate it
from the `user_roles.role_id` column.)

# Access patterns

- **Role assignments — two writers, never the client:**
  - `guest` — the status-sync trigger on [users](/users.md) (granted on
    approve, revoked on reject).
  - `admin` — out-of-band bootstrap only (steps in
    [users](/users.md)); no UI or API path grants admin in v1.
- **Permissions and role grants — migration only.** No client write path;
  changing a role's capabilities is a schema change, not a runtime one.
- **Reads:**
  - A user reads their own `user_roles` rows and their effective
    `user_permissions` to know what they are ([Current user
    state](../api/current-user-state.md)).
  - The admin reads all of the above (e.g. to show a user's state on the
    registrations page).
  - RLS itself reads via the `SECURITY DEFINER` helpers.

# RLS

RLS is enabled on every object but **not** forced (the owner manages
catalog rows via migrations). The only policies are SELECT:

| Object | Policy | Predicate |
|---|---|---|
| `roles` | `roles_read` | `to authenticated using (true)` — names are not sensitive |
| `permissions` | `permissions_read` | `to authenticated using (true)` — names are not sensitive |
| `role_permissions` | `role_permissions_read` | `using (public.has_role_id(role_permissions.role_id))` — grants of roles the caller holds |
| `user_roles` | `user_roles_read` | `using (user_id = auth.uid() or public.has_role('admin'))` — own rows; all rows for admins |

No INSERT/UPDATE/DELETE policies anywhere in the RBAC set — direct DML is
impossible from the client, which is what makes the
[users](/users.md) guard triggers sufficient.

**Data API grants:** per table — `service_role` all four (the
`user_roles` headroom is operational, for the sync trigger and
bootstrap); `authenticated` `select`; `anon` `select` only, which yields
zero rows since there is no anon policy (grants are mandatory on this
project — see [project notes](../platform/project.md)). The
`user_permissions` view gets `select` for `authenticated` and `anon`;
anon still sees zero rows via the base-table policies.
