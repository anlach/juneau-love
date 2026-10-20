-- Admin-notification stamp for new registrations (knowledge/api/
-- notify-registration.md).
--
-- users.admin_notified_at is set by the notify-registration edge function
-- (service role) when the admins are emailed about a pending registration,
-- so each registration notifies at most once. The client fires the function
-- at signup and again from the awaiting-approval screen as a fallback; the
-- stamp is what makes the repeat calls no-ops.
--
-- The guard gains the column in two places: the service_role error message
-- (the service_role writer class may now touch three columns: status,
-- last_login_link_sent_at, admin_notified_at — the check itself is
-- unchanged, it whitelists by the immutable columns), and the self branch,
-- where admin_notified_at joins the "display_name only" tuple so a guest
-- cannot suppress (or fake) their own admin notification.

alter table public.users add column admin_notified_at timestamptz;

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
      -- Edge functions: status (allowed transitions only) and the two
      -- notification timestamps (last_login_link_sent_at = the link-send
      -- cooldown stamp, admin_notified_at = the admin-alert stamp).
      -- Nothing else.
      if new.id is distinct from old.id then
        raise exception 'users: id is immutable';
      end if;
      if (new.email, new.display_name, new.email_confirmed_at) is distinct from
          (old.email, old.display_name, old.email_confirmed_at) then
        raise exception 'users: service_role may only change status, last_login_link_sent_at, or admin_notified_at';
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
      -- Self: display_name only. A hand-crafted self-update of status,
      -- email_confirmed_at, last_login_link_sent_at, or admin_notified_at
      -- is rejected even though RLS allows the row — this is what stops a
      -- user from claiming their own verification, gaming the link
      -- cooldown, or suppressing their own admin notification.
      if (new.status, new.email, new.email_confirmed_at,
          new.last_login_link_sent_at, new.admin_notified_at) is distinct from
          (old.status, old.email, old.email_confirmed_at,
           old.last_login_link_sent_at, old.admin_notified_at) then
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
