-- LOCAL DEVELOPMENT DATA ONLY.
--
-- This file is never applied to the hosted project: `supabase db push`
-- ignores it. It runs on `supabase db reset` / local stack boot, after the
-- migrations, to give the local stack a realistic set of users:
--
--   admin@local.dev    approved, admin + guest roles, email confirmed
--   guest@local.dev    approved, guest role, email confirmed
--   pending@local.dev  pending, unconfirmed (the "awaiting approval" screen)
--
-- Idempotent: safe to re-run.
--
-- To act as one of these users locally, mint a JWT and use it as the
-- Authorization bearer:
--   supabase gen jwt --role authenticated --user-id 11111111-1111-1111-1111-111111111111

-- 1. Auth users. The on_auth_user_created trigger creates the matching
--    public.users rows in `pending`.
insert into auth.users (id, email, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', 'admin@local.dev',   '{"display_name": "Local Admin"}'),
  ('22222222-2222-2222-2222-222222222222', 'guest@local.dev',   '{"display_name": "Local Guest"}'),
  ('33333333-3333-3333-3333-333333333333', 'pending@local.dev', '{"display_name": "Local Pending"}')
on conflict (id) do nothing;

-- 2. Confirm the admin + guest emails. Exercises on_auth_email_confirmed,
--    which mirrors the timestamp onto public.users.
update auth.users
set email_confirmed_at = now()
where id in ('11111111-1111-1111-1111-111111111111',
             '22222222-2222-2222-2222-222222222222')
  and email_confirmed_at is null;

-- 3. Approve admin + guest. Exercises the guard trigger's postgres branch
--    and the sync_user_role trigger, which grants the guest role.
update public.users
set status = 'approved'
where id in ('11111111-1111-1111-1111-111111111111',
             '22222222-2222-2222-2222-222222222222')
  and status = 'pending';

-- 4. Bootstrap the local admin's admin role (the out-of-band bootstrap step
--    from knowledge/db/users.md — no UI or API path grants admin).
insert into public.user_roles (user_id, role_id)
select u.id, r.id
from public.users u
join public.roles r on r.name = 'admin'
where u.id = '11111111-1111-1111-1111-111111111111'
on conflict (user_id, role_id) do nothing;
