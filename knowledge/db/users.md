---
type: db-table
title: users
description: One row per registered site user — the registration record with approval status. Users have no password and log in via short-lived GoTrue magiclinks (no credential lives in this table); email-verification state is mirrored from auth.users.
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-27T14:23:31Z }
---

# users

One row per registered site user. This is the **registration record** that
backs the registration-review flow: registering creates a row in
`pending`, an admin moves it to `approved` or `rejected`, and the
approval state drives both the user-facing screens ([Access by approval
status](../stories/access-by-approval-status.md)) and role assignment
([RBAC](/rbac.md)). The auth account itself lives in Supabase Auth
(`auth.users`); the login link is a **short-lived GoTrue magiclink** whose
token GoTrue owns — this table stores no credential ([Client
authentication](../api/client-auth.md)).

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
| `email_confirmed_at` | `timestamptz` | Mirrored from `auth.users.email_confirmed_at` by a trigger when the guest clicks the confirmation link. NULL = not verified yet. Drives the "verified" indicator on the registrations page; `registration-decision` refuses to approve while NULL. |
| `last_login_link_sent_at` | `timestamptz` | When [send-login-link](../api/send-login-link.md) last emailed a login link; drives the 10-minute resend cooldown. Written only by the edge function (service role). |
| `admin_notified_at` | `timestamptz` | When [notify-registration](../api/notify-registration.md) last alerted the admins about this pending registration; the idempotency stamp that makes each registration notify at most once. Written only by that function (service role). |
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
  last_login_link_sent_at timestamptz,
  admin_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Triggers: `on_auth_user_created` and `on_auth_email_confirmed` on
`auth.users`; `guard_user_row` (BEFORE INSERT OR UPDATE),
`sync_user_role` (BEFORE UPDATE), and `guard_user_delete`
(BEFORE DELETE) on `users`. The trigger functions have
`EXECUTE` revoked from `public`, `anon`, and `authenticated`, so a direct
call cannot bypass the guard — e.g. `select public.sync_user_role()`
would otherwise let a caller self-grant the guest role. No indexes beyond
the PK and the unique index on `email` — the registrations list is a few
hundred rows and doesn't justify one.

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
Trade-offs). Both side effects are done by the
[registration-decision](../api/registration-decision.md) function.

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

`SECURITY DEFINER` so the RLS policies below do not recurse into the
[RBAC](/rbac.md) tables' RLS.

# Access patterns

- **Row creation — auth trigger, not a client call.** A trigger on
  `auth.users` (AFTER INSERT) creates the row, copying `email` and
  `display_name` from `raw_user_meta_data` and setting
  `status = 'pending'`. The function raises if `display_name` is missing,
  which rolls back the whole auth signup (no orphaned auth user without a
  profile row). The self-insert policy below exists precisely to serve
  this trigger.
- **Role sync — atomic with the status update.** The `BEFORE UPDATE`
  trigger (`SECURITY DEFINER`) keeps [user_roles](/rbac.md) in sync:
  `status → 'approved'` upserts the `(user, guest)` role row;
  `status → 'rejected'` deletes it. It runs in the same transaction as
  the update, so approval and role grant/revoke cannot diverge.
- **Email-confirmation mirror — auth trigger, `SECURITY DEFINER`.** A
  trigger on `auth.users` (AFTER UPDATE OF `email_confirmed_at`) copies
  the confirmation timestamp onto this row so the admin can see who is
  verified and the decision function can enforce verify-then-approve.
  Gap: if an auth user is created *already confirmed* (e.g. the
  dashboard's auto-confirm box), no UPDATE fires and the mirror stays
  NULL — set `users.email_confirmed_at` manually in the owner console in
  that case.
- **Self read:** a signed-in user reads their own row to learn their
  approval state ([Current user state](../api/current-user-state.md)).
- **Self display-name update:** a signed-in user changes their own
  `display_name` from the change-name page — a [self-PATCH](../api/change-display-name.md)
  of that one column (the guard's only self-writable column; not gated on
  `status`; see [Change display name](../stories/change-display-name.md)).
- **Guest name join:** the self-read policy is what blocks guests from
  reading other users' rows; the `guest_names` view (documented with
  [assets](/assets.md)) is the only sanctioned way an approved guest sees
  another user's `display_name`.
- **Admin read:** the admin reads all rows for the registrations page
  ([List registrations](../api/registration-list.md)). No login
  credential is on this table at all (links are GoTrue-owned tokens), so
  the list never exposes any.
- **Admin-notification stamp — edge function only.**
  [notify-registration](../api/notify-registration.md) sets
  `admin_notified_at` after alerting the admins about a pending
  registration (the stamp makes the alert idempotent — at most one email
  per registration; a failed send is not stamped, so a later call
  retries).
- **Status changes — edge function only.** See
  [registration-decision](../api/registration-decision.md): it validates
  the caller is an admin, applies the transition, and handles the
  link/email side effects.
- **First-admin bootstrap (out-of-band, no UI path grants admin).** Run
  as the `postgres` role (Supabase SQL editor or migration):
  1. Create the auth user (dashboard: Auth → Users → Add user). The
     trigger creates a `users` row in `pending`.
  2. `update public.users set status = 'approved' where email = '<admin>';`
     — the sync trigger grants the `guest` role.
  3. `insert into public.user_roles (user_id, role_id) select u.id, r.id
     from public.users u, public.roles r
     where u.email = '<admin>' and r.name = 'admin';`
  An admin therefore holds **both** `guest` and `admin` roles. Bootstrap
  runs as the table owner and bypasses RLS by design (see RLS below).
  4. The admin's first login link comes from the normal sign-in page
  ([Sign in with a login link](../stories/sign-in-with-login-link.md)) —
  no special path.
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
zero rows). There is deliberately **no** UPDATE policy for `status`:
status writes flow only through the `registration-decision` edge function
(service role bypasses RLS), which has already verified the caller is an
admin.

**Data API grants:** `service_role` — `select, insert, update, delete`;
`authenticated` — `select, insert, update` (mirrors the policies above,
no `delete`); `anon` — `select` only, which yields zero rows since there
is no anon policy (grants are mandatory on this project — see
[project notes](../platform/project.md)).

The UPDATE policy is deliberately coarse (a user can touch their own
row); the `BEFORE UPDATE` guard trigger enforces the fine rules by
**writer class** (detected via `current_user` — `service_role` for edge
functions, `postgres` for the owner console — and `auth.uid()`):

- **`service_role` DB role** (edge functions): may change `status` only
  (transition must be allowed, table above) plus the two notification
  timestamps, `last_login_link_sent_at` and `admin_notified_at`. Nothing
  else.
- **`postgres` role** (our own `SECURITY DEFINER` triggers, plus the
  owner console / migrations / bootstrap): unrestricted — the accepted
  owner bypass; the sync triggers only ever touch their own column.
- **Self** (`authenticated`, `auth.uid() = user_id`): may change
  `display_name` only. A hand-crafted self-update of `status`,
  `email_confirmed_at`, `last_login_link_sent_at`, or `admin_notified_at`
  is rejected here even though RLS allows the row — this is what stops a
  user from claiming their own verification, gaming the link cooldown, or
  suppressing their own admin notification.
- Anything else → raise.
- Always: `updated_at` forced to `now()`.
- On INSERT → `status` forced to `'pending'` and `email_confirmed_at`
  forced to `null`, so a hand-crafted self-insert can never skip review
  or claim verification.

**Deletes — server-side roles only.** There is no DELETE policy, no
`delete` grant for `authenticated`, and a `BEFORE DELETE` guard
trigger (`guard_user_delete`) accepts only server-side roles
(`current_user` in `postgres`, `service_role`,
`supabase_auth_admin`); anything else raises. `postgres` covers the
owner console / migrations **and every `auth.users → users` FK
cascade**: a GoTrue admin delete — the supported way to remove a
user — fires the guard as `postgres` even though GoTrue's session
role is `supabase_auth_admin` (verified on the local stack
2026-10-27); `service_role` keeps the initial schema's delete grant
meaningful for edge functions (no v1 path). The guard is the
backstop for the [guest_names](/assets.md) view: DML through that
definer view would run with the owner's privileges, but the delete
is refused here (the view itself is read-only for client roles).
