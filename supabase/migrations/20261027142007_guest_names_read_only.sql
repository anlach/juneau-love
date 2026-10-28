-- Make public.guest_names read-only for client roles and backstop
-- public.users against deletes.
--
-- guest_names is SECURITY DEFINER (security_invoker = off — required to
-- escape users' own-row RLS for the gallery name join). Supabase sets
-- default privileges granting full table DML to postgres/anon/
-- authenticated/service_role on new public objects, and the view is
-- auto-updatable: DML through a definer view runs with the owner's
-- privileges (bypassing users RLS) while row triggers see current_user
-- as the calling role. With no DELETE policy and no delete guard, an
-- approved guest could delete any approved user through
-- DELETE /rest/v1/guest_names?id=eq.… — the victim's users row goes,
-- and the cascade takes their assets with it (knowledge/platform/
-- bugs.md, 2026-10-26 entry).
--
-- (1) Revoke the default-privilege DML (and anon's select — anon never
-- sees a row: is_approved() is false for NULL auth.uid()) from the
-- client roles on the view; re-pin select for authenticated, the only
-- sanctioned read surface. service_role and the owner are untouched.

revoke all on public.guest_names from anon, authenticated;
grant select on public.guest_names to authenticated;

-- (2) Backstop: a before-delete guard on users that accepts only
-- server-side roles, mirroring guard_user_row's writer-class style.
-- It is SECURITY INVOKER so current_user is the real caller:
--   postgres — owner console / migrations, and every
--              auth.users → users FK cascade (a GoTrue admin delete
--              fires this trigger as postgres, verified on the local
--              stack 2026-10-27)
--   service_role — edge functions (the initial schema's delete grant;
--              no v1 path)
--   supabase_auth_admin — GoTrue itself, in case a future version
--              deletes profile rows directly
-- Anything else raises, so a future client DML grant on any definer
-- view cannot reach users rows.

create or replace function public.guard_user_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_auth_admin') then
    return old;
  end if;
  raise exception 'users: delete not allowed for role %', current_user;
end;
$$;

create trigger guard_user_delete
before delete on public.users
for each row execute function public.guard_user_delete();

-- Trigger functions must not be callable directly (mirror of the
-- guard_user_row revoke); postgres (owner) keeps access.
revoke execute on function public.guard_user_delete()
from public, anon, authenticated;
