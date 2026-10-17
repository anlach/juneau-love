---
type: db-table
title: users
description: One row per registered site user — the registration record with approval status. Credentials live in Supabase Auth (auth.users); this table holds the profile and approval state the site uses for authorization.
status: draft
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-17T20:35:00Z }
---

# users

One row per registered site user. This is the **registration record** that
backs the registration-review flow: registering creates a row in `pending`,
an admin moves it to `approved` or `rejected`, and the approval state drives
both the user-facing screens and role assignment. Credentials and sessions
live in Supabase Auth (`auth.users`); this table is the public-facing profile.

# Schema

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` PK | `references auth.users(id) on delete cascade`. For a signed-in user this equals `auth.uid()`. |
| `email` | `text` NOT NULL UNIQUE | Denormalized from `auth.users.email`. Stored here because clients cannot read `auth.users`; the admin's registrations table renders emails from this column. |
| `display_name` | `text` NOT NULL | Name shown to the admin and on the site. Set at registration, editable by the user themselves only. |
| `status` | `text` NOT NULL DEFAULT `'pending'` | CHECK `in ('pending','approved','rejected')`. The approval state; the only column an admin may change on other users' rows. |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | Registration time. |
| `updated_at` | `timestamptz` NOT NULL DEFAULT `now()` | Set to `now()` by the guard trigger on every allowed update. |

Target DDL:

```sql
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text not null,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## Status transitions

Enforced by the `guard_user_row` trigger; anything else raises an error.
Only the `admin` role (via [user_roles](/user_roles.md)) may change `status`.

| from \ to | `pending` | `approved` | `rejected` |
|---|---|---|---|
| `pending` | — | admin | admin |
| `approved` | ✗ | — | admin |
| `rejected` | ✗ | admin (re-approve) | — |

## Helper function

```sql
create or replace function public.has_role(role_name text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid() and r.name = role_name
  );
$$;
```

`SECURITY DEFINER` so the RLS policies below do not recurse into
[user_roles](/user_roles.md) RLS.

# Access patterns

- **Row creation — auth trigger, not a client call.** A trigger on
  `auth.users` (AFTER INSERT) creates the row, copying `email` and
  `display_name` from `raw_user_meta_data` and setting `status = 'pending'`.
  The function raises if `display_name` is missing, which rolls back the
  whole auth signup (no orphaned auth user without a profile row). This is
  the standard Supabase `on_auth_user_created` pattern; verify at
  implementation time that the trigger's role context passes the INSERT
  policy below (the template's self-insert policy exists precisely for this).
- **Role sync — atomic with the status update.** A `BEFORE UPDATE`
  trigger (`SECURITY DEFINER`) keeps [user_roles](/user_roles.md) in sync:
  - `status → 'approved'`: upsert the `(user, guest)` role row.
  - `status → 'rejected'`: delete the `(user, guest)` role row.
  It runs in the same transaction as the update, so approval and role
  grant/revoke cannot diverge.
- **Self read:** a signed-in user reads their own row to learn their
  approval state (`knowledge/api/current-user-state.md`).
- **Admin read:** the admin reads all rows for the registrations page
  (`knowledge/api/registration-list.md`).
- **First-admin bootstrap (out-of-band, no UI path grants admin).** Run as
  the `postgres` role (Supabase SQL editor or migration):
  1. Create the auth user (dashboard: Auth → Users → Add user). The trigger
     creates a `users` row in `pending`.
  2. `update public.users set status = 'approved' where email = '<admin>';`
     — the sync trigger grants the `guest` role.
  3. `insert into public.user_roles (user_id, role_id) select u.id, r.id
     from public.users u, public.roles r
     where u.email = '<admin>' and r.name = 'admin';`
  An admin therefore holds **both** `guest` and `admin` roles. Bootstrap SQL
  runs as the table owner and bypasses RLS by design (see RLS below).
- **Email changes are not supported in v1.** If an auth email is changed
  out-of-band, `users.email` goes stale; keep the two in sync manually.

# RLS

RLS is enabled but **not** forced — the owner bypass is what makes
bootstrap and migrations possible; the `postgres` console is the project
owner's, so this is accepted.

| Policy | Op | Predicate |
|---|---|---|
| `users_read_own` | SELECT | `using (id = auth.uid())` |
| `admin_read_all` | SELECT | `using (public.has_role('admin'))` |
| `users_insert_own` | INSERT | `with check (id = auth.uid())` — serves the auth trigger; the guard below keeps a manual self-insert harmless |
| `admin_update_status` | UPDATE | `using (public.has_role('admin')) with check (public.has_role('admin'))` |
| `users_update_own` | UPDATE | `using (id = auth.uid()) with check (id = auth.uid())` |

No DELETE policy, no policy for `anon` (an unauthenticated session sees
zero rows).

The UPDATE policies are deliberately coarse; the `BEFORE UPDATE` guard
trigger enforces the fine rules:

- `status` change → caller must have the admin role and the transition must
  be allowed (table above).
- `display_name` change → self only (`auth.uid() = user_id`).
- `updated_at` → forced to `now()`.
- On INSERT → `status` forced to `'pending'`, so a hand-crafted self-insert
  can never skip review.
