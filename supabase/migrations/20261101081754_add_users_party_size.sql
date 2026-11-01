-- Party size for the RSVP feature (knowledge/stories/
-- rsvp-party-size.md): how many people in each guest's party will attend
-- the wedding.
--
-- NULL = no RSVP yet — the column is added without a DEFAULT, so an
-- approved guest's row stays null until their first save. 0 is a real
-- value ("none of my party is coming"), so the admin's headcount total
-- treats NULL as zero while the site keeps "hasn't rsvp'd" distinguishable
-- from "not coming" (knowledge/stories/review-registrations.md).
--
-- Range 0–8 mirrors the page's own validation; the CHECK is the DB
-- backstop for hand-crafted writes. The guard (writer-class rules)
-- changes with the column:
--   INSERT — party_size forced to null alongside status and
--            email_confirmed_at, so a hand-crafted self-insert can never
--            claim a party size;
--   service_role — party_size joins the immutable tuple: edge functions
--            never touch it (status, last_login_link_sent_at and
--            admin_notified_at remain their only writable columns);
--   self (authenticated, own row) — party_size joins display_name as a
--            self-writable column; its range is enforced by the CHECK,
--            not the guard.
-- No RLS or grant changes: users_update_own already scopes the row to
-- auth.uid(), and the existing table-level grants cover the new column.

alter table public.users
  add column party_size int
  check (party_size is null or party_size between 0 and 8);

create or replace function public.guard_user_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- A hand-crafted self-insert can never skip review, claim
    -- verification, or claim a party size.
    new.status := 'pending';
    new.email_confirmed_at := null;
    new.party_size := null;
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if current_user = 'service_role' then
      -- Edge functions: status (allowed transitions only) and the two
      -- notification timestamps (last_login_link_sent_at = the link-send
      -- cooldown stamp, admin_notified_at = the admin-alert stamp).
      -- Nothing else — party_size belongs to the guest themselves.
      if new.id is distinct from old.id then
        raise exception 'users: id is immutable';
      end if;
      if (new.email, new.display_name, new.email_confirmed_at, new.party_size)
          is distinct from
          (old.email, old.display_name, old.email_confirmed_at, old.party_size) then
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
      -- Self: display_name and party_size (the RSVP) only. A
      -- hand-crafted self-update of status, email, email_confirmed_at,
      -- last_login_link_sent_at, or admin_notified_at is rejected even
      -- though RLS allows the row — this is what stops a user from
      -- claiming their own verification, gaming the link cooldown, or
      -- suppressing their own admin notification. Out-of-range
      -- party_size values trip the CHECK constraint, not this guard.
      if (new.status, new.email, new.email_confirmed_at,
          new.last_login_link_sent_at, new.admin_notified_at) is distinct from
          (old.status, old.email, old.email_confirmed_at,
           old.last_login_link_sent_at, old.admin_notified_at) then
        raise exception 'users: you may only change your own display_name or party_size';
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
