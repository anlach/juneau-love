---
type: db-table
title: users
description: One row per registered site user — the registration record with approval status. Users have no password and log in via short-lived GoTrue magiclinks (no credential lives in this table); email-verification state is mirrored from auth.users.
status: stable
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-18T03:44:05Z }
---

# users

One row per registered site user. This is the **registration record** that
backs the registration-review flow: registering creates a row in `pending`,
an admin moves it to `approved` or `rejected`, and the approval state drives
both the user-facing screens and role assignment. The auth account lives in
Supabase Auth (`auth.users`); the login link is a
**short-lived GoTrue magiclink** whose token GoTrue owns — this table
stores no credential. It is the public-facing profile and approval state.

Before a guest gets access there are **two gates**: email verification
(Supabase Auth's confirmation email — automated; proves the guest controls
the address) and admin approval (`status` — the human vouching). The
verification state is mirrored here as `email_confirmed_at`; approval is
`status`. Approval is blocked until the email is verified.

# Schema

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` PK | `references auth.users(id) on delete cascade`. For a signed-in user this equals `auth.uid()`. |
| `email` | `text` NOT NULL UNIQUE | Denormalized from `auth.users.email`. Stored here because clients cannot read `auth.users`; the admin's registrations table renders emails from this column. |
| `display_name` | `text` NOT NULL | Name shown to the admin and on the site. Set at registration, editable by the user themselves only. |
| `email_confirmed_at` | `timestamptz` | Mirrored from `auth.users.email_confirmed_at` by a trigger when the guest clicks the confirmation link. NULL = not verified yet. Drives the "verified" indicator on the admin's registrations table; `registration-decision` refuses to approve while NULL. |
| `last_login_link_sent_at` | `timestamptz` | **Planned (follow-up migration — not in the initial schema).** When [send-login-link](../api/send-login-link.md) last emailed a login link; drives the 10-minute resend cooldown. Written only by the edge function (service role). |
| `status` | `text` NOT NULL DEFAULT `'pending'` | CHECK `in ('pending','approved','rejected')`. The approval state; the only column ever changed by an admin, and only through the `registration-decision` edge function (never by a client). |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | Registration time. |
| `updated_at` | `timestamptz` NOT NULL DEFAULT `now()` | Set to `now()` by the guard trigger on every allowed update. |

Target DDL:

```sql
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text not null,
  email_confirmed_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  last_login_link_sent_at timestamptz,  -- planned; follow-up migration
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## Shipped

`supabase/migrations/20261018033502_initial_schema.sql` (applied as
`postgres` via `supabase db push`; see [Deploy notes](../platform/deploy.md)).
Trigger names: `on_auth_user_created` and `on_auth_email_confirmed` on
`auth.users`; `guard_user_row` (BEFORE INSERT OR UPDATE) and
`sync_user_role` (BEFORE UPDATE) on `users`. No indexes beyond the PK and
the unique index on `email` — the registrations list is a few hundred rows
ordered by `created_at` and doesn't justify one. The initial migration does
**not** include `last_login_link_sent_at`; a follow-up migration adds the
column and extends the `guard_user_row` writer rules (service role may
then also write that column).

The four trigger functions have `EXECUTE` revoked from `public`, `anon`,
and `authenticated`, so a direct call cannot bypass the guard — e.g.
`select public.sync_user_role()` would otherwise let a caller self-grant
the guest role.

## Status transitions

Enforced by the `guard_user_row` trigger; anything else raises an error.
Status changes arrive **only via the `registration-decision` edge
function** (service role, after it has verified the human caller is an
admin); there is no client write path for `status`.

| from \ to | `pending` | `approved` | `rejected` |
|---|---|---|---|
| `pending` | — | admin | admin |
| `approved` | ✗ | — | admin |
| `rejected` | ✗ | admin (re-approve) | — |

Approving additionally generates a GoTrue magiclink for the guest and
emails it; rejecting ends link eligibility (a previously emailed link can
still be exchanged for a short while — RLS + the client rejection screen
are the backstop; see [Client authentication](../api/client-auth.md),
Design notes). Both are done by the edge function — see
[registration-decision](../api/registration-decision.md)).

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
- **Email-confirmation mirror — auth trigger, `SECURITY DEFINER`.** A
  trigger on `auth.users` (AFTER UPDATE OF `email_confirmed_at`) copies the
  confirmation timestamp onto this row so the admin can see who is verified
  and the decision function can enforce verify-then-approve. Runs as the
  table owner, so it needs no RLS policy of its own (the guard's owner
  branch covers it). Gap: if an auth user is created *already confirmed*
  (e.g. the dashboard's auto-confirm box), no UPDATE fires and the mirror
  stays NULL — set `users.email_confirmed_at` manually in the owner
  console in that case.
- **Self read:** a signed-in user reads their own row to learn their
  approval state ([Current user state](../api/current-user-state.md)).
- **Guest name join:** the self-read policy above is what blocks
  guests from reading other users' rows; the `guest_names` view
  (documented with [assets](/assets.md)) is the only sanctioned way
  an approved guest sees another user's `display_name`.
- **Admin read:** the admin reads all rows for the registrations page
  ([List registrations](../api/registration-list.md)). Note no login
  credential is on this table at all (links are GoTrue-owned short-lived
  tokens), so the admin's list never exposes any.
- **Status changes — edge function only.** The `registration-decision`
  function (service role) is the sole writer of `status`: it validates the
  caller is an admin, applies the transition, and — on approve — generates
  a GoTrue magiclink and sends the invite email; on reject it ends link
  eligibility. See
  [registration-decision](../api/registration-decision.md).
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
  4. The admin has no login link yet: their first link comes from the
     normal sign-in page (enter their email →
     `send-login-link` serves any approved user), no special path.
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
| `users_update_own` | UPDATE | `using (id = auth.uid()) with check (id = auth.uid())` — for `display_name`; the guard below blocks any other column |

No DELETE policy, no policy for `anon` (an unauthenticated session sees
zero rows). There is deliberately **no** UPDATE policy for `status`: status
writes flow only through the `registration-decision` edge function
(service role bypasses RLS), which has already verified the caller is an
admin.

**Data API grants** (shipped): `service_role` — `select, insert, update,
delete`; `authenticated` — `select, insert, update` (mirrors the policies
above, no `delete`); `anon` — `select` only, which yields zero rows since
there is no anon policy. This project does not auto-expose new tables to
the Data API, so the grants in the migration are mandatory, not cosmetic.

The UPDATE policy is deliberately coarse (a user can touch their own row);
the `BEFORE UPDATE` guard trigger enforces the fine rules by **writer
class** (detected via `current_user` — `service_role` for edge functions,
`postgres` for the owner console — and `auth.uid()`):

- **`service_role` DB role** (edge functions): may change `status` only
  (transition must be allowed, table above) — plus `last_login_link_sent_at`
  (planned, with the follow-up migration). Nothing else.
- **`postgres` role** (our own `SECURITY DEFINER` sync triggers, plus the
  owner console / migrations / bootstrap): unrestricted — the accepted
  owner bypass; the sync triggers only ever touch their own column.
- **Self** (`authenticated`, `auth.uid() = user_id`): may change
  `display_name` only. A hand-crafted self-update of `status` or
  `email_confirmed_at` is rejected here even though RLS allows the row —
  this is what stops a user from claiming their own verification.
- Anything else → raise.
- Always: `updated_at` forced to `now()`.
- On INSERT → `status` forced to `'pending'` and `email_confirmed_at`
  forced to `null`, so a hand-crafted self-insert can never skip review or
  claim verification.
