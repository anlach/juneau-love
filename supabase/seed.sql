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
--   supabase gen bearer-jwt --role authenticated --sub 11111111-1111-1111-1111-111111111111

-- 1. Auth users. The on_auth_user_created trigger creates the matching
--    public.users rows in `pending`.
--
--    instance_id, aud and role have no column defaults in this GoTrue
--    version (the app code sets them on real signups). GoTrue's user
--    lookup filters on `instance_id = uuid.Nil AND aud = 'authenticated'
--    AND is_sso_user = false`, so raw inserts that omit them make admin
--    calls (e.g. generate_link) treat the user as missing and 500 with a
--    duplicate-key error. The token columns have no DB defaults and
--    GoTrue scans them into non-null Go strings, so they must be empty
--    strings, not NULL. created_at/updated_at are set for tidiness.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                        confirmation_token, recovery_token, email_change_token_new, email_change,
                        created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@local.dev',   '{"display_name": "Local Admin"}',   '', '', '', '', now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'guest@local.dev',   '{"display_name": "Local Guest"}',   '', '', '', '', now(), now()),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pending@local.dev', '{"display_name": "Local Pending"}', '', '', '', '', now(), now())
on conflict (id) do nothing;

-- 1b. GoTrue email identities (one per user). A real signup creates one;
--     some GoTrue paths resolve users via the identity row, so seed it to
--     keep the local users realistic. identity_data mirrors what GoTrue
--     writes for an email signup. (The `email` column is generated from
--     identity_data and must not be written.)
insert into auth.identities (id, user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at)
values
  ('81111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'email', '82111111-1111-1111-1111-111111111111',
   jsonb_build_object('sub','11111111-1111-1111-1111-111111111111','email','admin@local.dev','display_name','Local Admin','email_verified',true,'phone_verified',false),
   now(), now(), now()),
  ('83111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'email', '84111111-1111-1111-1111-111111111111',
   jsonb_build_object('sub','22222222-2222-2222-2222-222222222222','email','guest@local.dev','display_name','Local Guest','email_verified',true,'phone_verified',false),
   now(), now(), now()),
  ('85111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'email', '86111111-1111-1111-1111-111111111111',
   jsonb_build_object('sub','33333333-3333-3333-3333-333333333333','email','pending@local.dev','display_name','Local Pending','email_verified',false,'phone_verified',false),
   now(), now(), now())
on conflict (id) do nothing;

-- 2. Confirm the admin + guest emails. Exercises on_auth_email_confirmed,
--    which mirrors the timestamp onto public.users. (auth.users.confirmed_at
--    is a generated column — LEAST(email_confirmed_at, phone_confirmed_at) —
--    so it derives automatically.)
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

-- 5. The juneau-assets storage bucket for the asset gallery. With JL_ENV=dev
--    (config.toml [edge_runtime.secrets]) the edge functions presign against
--    the local storage S3 protocol, and e2e/approved-guest.spec.ts uploads a
--    real photo into this bucket. storage.buckets does not survive
--    `supabase db reset`, so the bucket is created here, idempotently, instead
--    of a manual curl per stack.
insert into storage.buckets (id, name, public, created_at, updated_at)
values ('juneau-assets', 'juneau-assets', false, now(), now())
on conflict (id) do nothing;

