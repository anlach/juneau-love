-- Initial schema: users, login_passcodes, RBAC catalog (roles, permissions,
-- role_permissions, user_roles), views (user_permissions, guest_names),
-- triggers, RLS policies, Data API grants, and the RBAC seed rows.
--
-- Source of truth: knowledge/db (one concept per table) + knowledge/api.
-- Applied as the `postgres` role via `supabase db push`.
--
-- Data API exposure: this project was created after 2026-05-30, so new
-- tables in `public` are NOT exposed to PostgREST unless explicitly
-- granted. Every GRANT below is deliberate and matches the access model
-- documented in knowledge/db.
--
-- The RBAC seed (roles/permissions/role_permissions) is idempotent:
-- `on conflict do nothing` keeps re-runs harmless. seed.sql is local-dev
-- data only and is never applied here.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text not null,
  email_confirmed_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.login_passcodes (
  user_id uuid primary key references public.users (id) on delete cascade,
  passcode text not null unique,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  sent_at timestamptz not null default now()
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table public.role_permissions (
  role_id uuid not null references public.roles (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.user_roles (
  user_id uuid not null references public.users (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  s3_key text not null unique,
  content_type text not null
    check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size bigint not null check (byte_size > 0),
  caption text,
  created_at timestamptz not null default now()
);

-- Indexes. The composite PKs already cover the (user_id, role_id) and
-- (role_id, permission_id) lookup paths used by the RLS helpers; the
-- user_id FK columns on those join tables are the leading key, so no
-- separate FK index is needed. user_roles.role_id and
-- role_permissions.permission_id are intentionally unindexed: both
-- catalogs are tiny and never deleted in v1.
create index assets_user_id_idx on public.assets (user_id);
-- Gallery read: all rows ordered newest first.
create index assets_created_at_idx on public.assets (created_at desc);

-- ---------------------------------------------------------------------------
-- RBAC seed (idempotent)
-- ---------------------------------------------------------------------------

insert into public.roles (name, description) values
  ('admin', 'Site administrator: reviews and manages registrations.'),
  ('guest', 'Approved wedding guest with access to guest content.')
on conflict (name) do nothing;

insert into public.permissions (name, description) values
  ('registrations:read',    'View the list of all registrations and their approval state.'),
  ('registrations:approve', 'Approve a registration (grants the guest role).'),
  ('registrations:reject',  'Reject a registration (revokes the guest role).')
on conflict (name) do nothing;

-- admin gets every registrations permission; the guest role holds none in
-- v1 (guest access is gated on approval state, not permissions).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.name = 'admin'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so RLS policies do not recurse into user_roles/users
-- RLS. Each is safe for any role to call: it keys on auth.uid() (NULL for
-- anon) and returns a boolean only.

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

create or replace function public.has_role_id(role_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = auth.uid() and role_id = has_role_id.role_id
  );
$$;

create or replace function public.is_approved()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users
    where id = auth.uid() and status = 'approved'
  );
$$;

-- ---------------------------------------------------------------------------
-- Trigger functions
-- ---------------------------------------------------------------------------

-- Creates the profile row when an auth user is created (client registration
-- or a dashboard user such as the first admin). Raises if display_name is
-- missing so the signup rolls back instead of leaving an orphaned auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'display_name', '') = '' then
    raise exception 'users: display_name is required in raw_user_meta_data';
  end if;
  insert into public.users (id, email, display_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'display_name');
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Mirrors auth.users.email_confirmed_at onto the profile row when the guest
-- clicks the confirmation link. Runs as the table owner (postgres).
create or replace function public.handle_email_confirmation()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.users
  set email_confirmed_at = new.email_confirmed_at
  where id = new.id;
  return new;
end;
$$;

create trigger on_auth_email_confirmed
after update of email_confirmed_at on auth.users
for each row execute function public.handle_email_confirmation();

-- Fine-grained write rules for public.users, enforced by writer class
-- (current_user: service_role = edge functions, postgres = owner console /
-- migrations / our own SECURITY DEFINER triggers, authenticated = the user
-- themselves). Must stay SECURITY INVOKER so current_user reflects the real
-- caller; the accepted owner bypass is the postgres branch.
create or replace function public.guard_user_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- A hand-crafted self-insert can never skip review or claim
    -- verification.
    new.status := 'pending';
    new.email_confirmed_at := null;
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if current_user = 'service_role' then
      -- Edge functions: status only, and only an allowed transition.
      if new.id is distinct from old.id then
        raise exception 'users: id is immutable';
      end if;
      if (new.email, new.display_name, new.email_confirmed_at) is distinct from
          (old.email, old.display_name, old.email_confirmed_at) then
        raise exception 'users: service_role may only change status';
      end if;
      if new.status is distinct from old.status
         and not ((old.status, new.status) in
                  (('pending', 'approved'), ('pending', 'rejected'),
                   ('approved', 'rejected'), ('rejected', 'approved'))) then
        raise exception 'users: disallowed status transition % -> %',
          old.status, new.status;
      end if;
    elsif current_user = 'postgres' then
      -- Owner console / migrations / our SECURITY DEFINER triggers:
      -- accepted owner bypass; the sync trigger only ever touches the
      -- guest role row, the mirror trigger only email_confirmed_at.
    elsif current_user = 'authenticated' and old.id = auth.uid() then
      -- Self: display_name only. A hand-crafted self-update of status or
      -- email_confirmed_at is rejected even though RLS allows the row.
      if (new.status, new.email, new.email_confirmed_at) is distinct from
          (old.status, old.email, old.email_confirmed_at) then
        raise exception 'users: you may only change your own display_name';
      end if;
    else
      raise exception 'users: update not allowed for role %', current_user;
    end if;
    new.updated_at := now();
    return new;
  end if;

  raise exception 'users: guard_user_row must be run as a trigger';
end;
$$;

create trigger guard_user_row
before insert or update on public.users
for each row execute function public.guard_user_row();

-- Keeps public.user_roles in sync with approval state, atomically with the
-- status update: approved grants the guest role, rejected revokes it.
-- SECURITY DEFINER (owner postgres) so it bypasses user_roles RLS. Fires
-- after guard_user_row (alphabetical trigger order) so rejected updates
-- never sync.
create or replace function public.sync_user_role()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  guest_role_id uuid;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    select id into guest_role_id from public.roles where name = 'guest';
    insert into public.user_roles (user_id, role_id)
    values (new.id, guest_role_id)
    on conflict (user_id, role_id) do nothing;
  elsif new.status = 'rejected' and old.status is distinct from 'rejected' then
    delete from public.user_roles ur
    using public.roles r
    where ur.user_id = new.id and ur.role_id = r.id and r.name = 'guest';
  end if;
  return new;
end;
$$;

create trigger sync_user_role
before update on public.users
for each row execute function public.sync_user_role();

-- Trigger functions must not be callable directly: e.g.
-- `select public.sync_user_role()` would let an authenticated caller
-- self-grant the guest role, and `handle_new_user` would bypass the
-- INSERT guard. Revoke the PUBLIC default; postgres (owner) keeps access.
revoke execute on function
  public.handle_new_user(),
  public.handle_email_confirmation(),
  public.guard_user_row(),
  public.sync_user_role()
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

-- Effective permission names per user (one row per user, permission).
-- security_invoker = true so the base tables' RLS (user_roles,
-- role_permissions, permissions) filters the result to what the caller may
-- see; no independent RLS on the view.
create view public.user_permissions with (security_invoker = true) as
select ur.user_id,
       p.name as permission
from public.user_roles ur
join public.role_permissions rp on rp.role_id = ur.role_id
join public.permissions p       on p.id = rp.permission_id;

-- Display names of approved users, visible only to approved callers.
-- security_invoker = off (runs as the owner, postgres) so it is exempt from
-- users RLS; the view's own WHERE clause is the only gate: is_approved()
-- keeps unapproved callers at zero rows, status = 'approved' keeps
-- pending/rejected names out of the result even for approved callers.
create view public.guest_names with (security_invoker = off) as
select id, display_name
from public.users
where status = 'approved' and public.is_approved();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Enabled but NOT forced on any table: the owner (postgres) bypass is the
-- accepted convention that makes bootstrap, migrations, and out-of-band
-- seeding work. Policies use the TO clause (auth.role() is deprecated).
-- No policy targets anon: an unauthenticated session sees zero rows.

alter table public.users enable row level security;
create policy users_read_own on public.users
  for select to authenticated
  using (id = auth.uid());
create policy admin_read_all on public.users
  for select to authenticated
  using (public.has_role('admin'));
create policy users_insert_own on public.users
  for insert to authenticated
  with check (id = auth.uid());
create policy users_update_own on public.users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
-- No DELETE policy, no UPDATE path for status: status writes flow only
-- through the registration-decision edge function (service_role bypasses
-- RLS) after it has verified the caller is an admin.

alter table public.login_passcodes enable row level security;
-- No policies at all: every non-bypassing role sees zero rows. The passcode
-- is a 7-day bearer credential; edge functions (service_role) bypass RLS.
-- Never add a SELECT policy here without re-review.

alter table public.roles enable row level security;
create policy roles_read on public.roles
  for select to authenticated
  using (true);

alter table public.permissions enable row level security;
create policy permissions_read on public.permissions
  for select to authenticated
  using (true);

alter table public.role_permissions enable row level security;
create policy role_permissions_read on public.role_permissions
  for select to authenticated
  using (public.has_role_id(role_permissions.role_id));

alter table public.user_roles enable row level security;
create policy user_roles_read on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or public.has_role('admin'));
-- No DML policies: direct DML is impossible from the client, which is what
-- makes the users-table guard triggers sufficient.

alter table public.assets enable row level security;
create policy assets_read_approved on public.assets
  for select to authenticated
  using (public.is_approved());
create policy assets_insert_own on public.assets
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved());
-- The INSERT predicate is deliberately gated on approval: a
-- confirmed-but-pending user must not plant gallery rows. No UPDATE or
-- DELETE policies in v1.

-- ---------------------------------------------------------------------------
-- Data API grants
-- ---------------------------------------------------------------------------
-- This project does not auto-expose new tables, so the PostgREST roles need
-- explicit grants. They are deliberately minimal and mirror the RLS
-- surface above: DML grants only where a client DML policy exists. Read
-- grants on tables that have no anon policy give anon zero rows (not a
-- permission error). login_passcodes gets no DML grant for any API role:
-- even a future policy mistake cannot turn into a client write.

grant select, insert, update, delete
  on public.users, public.login_passcodes, public.roles, public.permissions,
     public.role_permissions, public.user_roles, public.assets
  to service_role;

grant select, insert, update on public.users to authenticated;
grant select on public.login_passcodes to authenticated;
grant select on public.roles, public.permissions, public.role_permissions,
                public.user_roles to authenticated;
grant select, insert on public.assets to authenticated;
grant select on public.user_permissions to authenticated;
grant select on public.guest_names to authenticated;

grant select on public.users, public.login_passcodes, public.roles,
                public.permissions, public.role_permissions, public.user_roles,
                public.assets to anon;
grant select on public.user_permissions to anon;
