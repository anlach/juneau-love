---
type: user-story
title: RSVP for the wedding and the whale watch
description: An approved guest tells the hosts how many people in their party will attend the wedding AND the whale watch (the day before) via a two-field RSVP page — the landing card's primary action. Each count is null until first saved (0–8, where 0 means "not coming"); the guest may register a different number per event, and each count feeds its own admin headcount total, where an unset (null) count counts for zero.
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-11-15T22:40:00Z }
---

# RSVP for the wedding and the whale watch

**As an** approved guest,
**I want to** tell the hosts how many people in my party will attend the
wedding, and how many will join the whale watch the day before,
**so that** they can plan the venue, plates, and seating — and the seats
on the boat.

## Flow

1. An approved guest's landing card offers **RSVP** as its primary action
   — it replaced the old "See the photos" card link (Photos stays in the
   nav; the [Whale watch](/whale-watch.md) page is reachable from the nav
   and from the RSVP page's own copy). The link goes to `/rsvp`.
2. The page is approval-gated like all guest content: `pending` and
   `rejected` guests see their usual state screens, anonymous visitors a
   sign-in prompt; only `approved` guests see the form (see [Access by
   approval status](/access-by-approval-status.md)).
3. The page's intro line invites guests to the whale watch the day
   before, linking "whale watch" to the [Whale watch](/whale-watch.md)
   page. The form is two number fields — "Wedding (Sat, June 19) — how
   many of you are coming?" and "Whale watch (Fri, June 18) — how many of
   you are coming?" — each pre-filled from the guest's saved count (empty
   while still null), plus a note that guests may register separately but
   mustn't double-count themselves. Saving self-PATCHes `party_size` and
   `whale_watch_party_size` on the guest's own `users` row in one write
   and shows a thank-you note.
4. Saving again updates the numbers (both fields pre-fill on every load);
   the row keeps the latest values.

## Acceptance criteria

- [ ] The landing card's primary action links to the RSVP page; the
      gallery link is nav-only.
- [ ] Only approved guests see the form — `pending`/`rejected` see their
      state screens, anonymous a sign-in prompt. (Gating is UX; RLS, the
      guard, and the CHECKs enforce the write for real.)
- [ ] Each field is empty until the guest has rsvp'd (the columns' null
      defaults), and pre-fills the saved number afterwards.
- [ ] Saves accept whole numbers 0 to 8 in **both** fields; anything else
      — including an emptied field — is refused with the range message and
      the saved values stand.
- [ ] A hand-crafted write is refused beyond the guest's own row, the
      other columns, and the 0–8 range on each column
      ([users](../db/users.md)).
- [ ] The admin's registrations table shows each guest's wedding and
      whale counts (em dash while null) and a headcount total per event
      (see [Review registrations](/review-registrations.md)).

## Business rules

- **Null means "hasn't rsvp'd", not zero — per column.** Both columns are
  NULL by default and the page's fields are empty; the first save sets
  both. 0 is a real, meaningful value ("none of my party is coming"), so
  the UI never writes null to clear an RSVP — empty input is refused and
  the saved numbers stand (the whole save, not just the field).
- **Range 0–8 per event.** A party is at most eight people; the page
  validates first and the DB CHECKs are the backstop for hand-crafted
  writes.
- **Different numbers per event are allowed — no double-counting.** The
  guest may send fewer people whale watching than to the wedding (or
  vice versa); the page tells guests to register separately but not to
  double-count themselves, because each column is summed for its own
  headcount.
- **The headcounts count approved rows only, and null counts for zero.**
  The hosts' expected headcount is the sum of `party_size` (wedding) and
  `whale_watch_party_size` (whale watch) over approved guests, each with
  an unset (null) count as 0 — a pending or rejected guest's numbers are
  shown in the table but never counted (the totals and the columns render
  in [Review registrations](/review-registrations.md)).
- **No un-RSVP.** v1 has no "clear my RSVP" action; a guest changes the
  numbers, they don't delete them.

## Depends on

- [users](../db/users.md) (the `party_size` and
  `whale_watch_party_size` columns, the guard's self-writable rule, the
  CHECKs)
- [RSVP party size](../api/rsvp-party-size.md) (the self-PATCH)
- [Current user state](../api/current-user-state.md) (the profile read that
  pre-fills the fields)
- [Access by approval status](/access-by-approval-status.md) (the gating)
- [Whale watch](/whale-watch.md) (the event being counted)
