---
type: db-table
title: role_permissions
description: Join table granting permissions to roles. Seeded so the admin role holds all three registrations permissions; the guest role holds none in v1.
status: draft
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-17T20:35:00Z }
---

# role_permissions

Grant of [permissions](/permissions.md) to [roles](/roles.md). This table
decides which capabilities a role carries; per-user resolution is exposed
through the [user_permissions](/user_permissions.md) view.

# Schema

| Column | Type | Description |
|---|---|---|
| `role_id` | `uuid` NOT NULL | `references roles(id) on delete cascade` (part of PK). |
| `permission_id` | `uuid` NOT NULL | `references permissions(id) on delete cascade` (part of PK). |
| — | PK | `(role_id, permission_id)` |

Target DDL and seed:

```sql
create table public.role_permissions (
  role_id uuid not null references public.roles (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  primary key (role_id, permission_id)
);

-- admin gets every registrations permission
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.name = 'admin';
-- guest role: intentionally no permissions in v1.
```

## Helper function

```sql
create or replace function public.has_role_id(role_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role_id = role_permissions.role_id
  );
$$;
```

(Used by the SELECT policy below; `SECURITY DEFINER` avoids RLS
recursion. `has_role(text)` is documented in [users](/users.md).)

# Access patterns

- **Read:** a user may read only the permission grants of roles *they
  hold* (policy below). The admin sees grants for `admin` and `guest`;
  a guest sees the (empty) `guest` grants.
- **Write:** never from the client. Grants are seeded by migration;
  changing a role's capabilities later is a migration concern, not a
  runtime one.

# RLS

```sql
create policy "role_permissions_read" on public.role_permissions
  for select to authenticated
  using (public.has_role_id(role_permissions.role_id));
```

No INSERT/UPDATE/DELETE policies.
