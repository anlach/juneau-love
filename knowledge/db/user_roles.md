---
type: db-table
title: user_roles
description: Join table assigning roles to users. The guest role is written only by the users status-sync trigger; the admin role only by out-of-band bootstrap. No client DML.
status: draft
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-17T21:46:01Z }
---

# user_roles

Assignment of [roles](/roles.md) to [users](/users.md). A user's
capabilities are the union of the permissions of their roles
([role_permissions](/role_permissions.md)).

# Schema

| Column | Type | Description |
|---|---|---|
| `user_id` | `uuid` NOT NULL | `references users(id) on delete cascade` (part of PK). |
| `role_id` | `uuid` NOT NULL | `references roles(id) on delete cascade` (part of PK). |
| `assigned_at` | `timestamptz` NOT NULL DEFAULT `now()` | When the assignment was made. |
| — | PK | `(user_id, role_id)` |

Target DDL:

```sql
create table public.user_roles (
  user_id uuid not null references public.users (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (user_id, role_id)
);
```

# Access patterns

- **Writes — no client path at all** (no DML policies). Two writers:
  - The `BEFORE UPDATE` sync trigger on [users](/users.md)
    (`SECURITY DEFINER`, so it bypasses this table's RLS): upserts
    `(user, guest)` when the status becomes `approved`, deletes it when it
    becomes `rejected`.
  - First-admin bootstrap SQL inserting `(admin user, admin role)` —
    see the bootstrap steps in [users](/users.md).
- **Reads:**
  - A user reads their own role rows to know what they are
    ([Current user state](../api/current-user-state.md)).
  - The admin reads all assignments (e.g. to display a user's role on the
    registrations page).
  - RLS itself reads this table via the `SECURITY DEFINER`
    `public.has_role(text)` helper (documented in [users](/users.md)).

# RLS

```sql
create policy "user_roles_read" on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or public.has_role('admin'));
```

No INSERT/UPDATE/DELETE policies — direct DML is impossible from the
client, which is what makes the users-table guard triggers sufficient.
RLS is not forced; bootstrap runs as the owner.
