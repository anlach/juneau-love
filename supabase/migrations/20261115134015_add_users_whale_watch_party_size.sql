-- Whale-watch party size (knowledge/stories/whale-watch.md): how many
-- people in each guest's party will join the whale watch on Friday,
-- June 18, 2027 — the day before the wedding.
--
-- Mirrors party_size exactly: NULL = no RSVP yet (the column is added
-- without a DEFAULT, so the row stays null until the guest's first
-- save). 0 is a real value ("none of my party is coming"). A guest may
-- register a different number for each event — the two counts stay
-- distinct columns, and the hosts sum each column over approved rows
-- for separate headcounts
-- (knowledge/stories/review-registrations.md).
--
-- Range 0–8 mirrors the page's own validation; the CHECK is the DB
-- backstop for hand-crafted writes. The guard (writer-class rules)
-- changes with the column:
--   INSERT — whale_watch_party_size forced to null alongside status,
--            email_confirmed_at and party_size, so a hand-crafted
--            self-insert can never claim a whale-watch count;
--   service_role — whale_watch_party_size joins the immutable tuple:
--            edge functions never touch it (status,
--            last_login_link_sent_at and admin_notified_at remain
--            their only writable columns);
--   self (authenticated, own row) — whale_watch_party_size joins
--            display_name and party_size as a self-writable column; its
--            range is enforced by the CHECK, not the guard.
-- No RLS or grant changes: users_update_own already scopes the row to
-- auth.uid(), and the existing table-level grants cover the new column.

alter table public.users
  add column whale_watch_party_size int
  check (whale_watch_party_size is null or whale_watch_party_size between 0 and 8);

create or replace function public.guard_user_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- A hand-crafted self-insert can never skip review, claim
    -- verification, or claim a party size (wedding or whale watch).
    new.status := 'pending';
    new.email_confirmed_at := null;
    new.party_size := null;
    new.whale_watch_party_size := null;
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if current_user = 'service_role' then
      -- Edge functions: status (allowed transitions only) and the two
      -- notification timestamps (last_login_link_sent_at = the link-send
      -- cooldown stamp, admin_notified_at = the admin-alert stamp).
      -- Nothing else — the RSVP counts belong to the guest themselves.
      if new.id is distinct from old.id then
        raise exception 'users: id is immutable';
      end if;
      if (new.email, new.display_name, new.email_confirmed_at, new.party_size,
          new.whale_watch_party_size) is distinct from
          (old.email, old.display_name, old.email_confirmed_at, old.party_size,
           old.whale_watch_party_size) then
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
      -- Self: display_name, party_size and whale_watch_party_size (the
      -- two RSVP counts) only. A hand-crafted self-update of status,
      -- email, email_confirmed_at, last_login_link_sent_at, or
      -- admin_notified_at is rejected even though RLS allows the row —
      -- this is what stops a user from claiming their own verification,
      -- gaming the link cooldown, or suppressing their own admin
      -- notification. Out-of-range RSVP values trip the CHECK
      -- constraints, not this guard.
      if (new.status, new.email, new.email_confirmed_at,
          new.last_login_link_sent_at, new.admin_notified_at) is distinct from
          (old.status, old.email, old.email_confirmed_at,
           old.last_login_link_sent_at, old.admin_notified_at) then
        raise exception 'users: you may only change your own display_name, party_size, or whale_watch_party_size';
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
