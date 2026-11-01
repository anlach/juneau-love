---
type: user-story
title: RSVP with a party size
description: An approved guest tells the hosts how many people in their party will attend via a one-field RSVP page — the landing card's primary action. Party size is null until first saved (0–8, where 0 means "not coming"), and feeds the admin's expected-headcount total, where an unset (null) party size counts for zero.
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-11-01T16:33:44Z }
---

# RSVP with a party size

**As an** approved guest,
**I want to** tell the hosts how many people in my party will attend the
wedding,
**so that** they can plan the venue, plates, and seating.

## Flow

1. An approved guest's landing card offers **RSVP** as its primary action —
   it replaced the old "See the photos" card link (Photos stays in the
   nav). The link goes to `/rsvp`.
2. The page is approval-gated like all guest content: `pending` and
   `rejected` guests see their usual state screens, anonymous visitors a
   sign-in prompt; only `approved` guests see the form (see [Access by
   approval status](/access-by-approval-status.md)).
3. The form is a single number field — "How many of you are coming?" —
   pre-filled from the guest's saved `party_size` (empty while still
   null). Saving self-PATCHes `party_size` on the guest's own `users` row
   and shows a thank-you note.
4. Saving again updates the number (the field pre-fills on every load); the
   row keeps the latest value.

## Acceptance criteria

- [ ] The landing card's primary action links to the RSVP page; the
      gallery link is nav-only.
- [ ] Only approved guests see the form — `pending`/`rejected` see their
      state screens, anonymous a sign-in prompt. (Gating is UX; RLS, the
      guard, and the CHECK enforce the write for real.)
- [ ] The field is empty until the guest has rsvp'd (the column's null
      default), and pre-fills the saved number afterwards.
- [ ] Saves accept whole numbers 0 to 8 only; anything else — including an
      emptied field — is refused with the range message and the saved value
      stands.
- [ ] A hand-crafted write is refused beyond the guest's own row, the other
      columns, and the 0–8 range ([users](../db/users.md)).
- [ ] The admin's registrations table shows each guest's party size (em
      dash while null) and an expected-headcount total (see [Review
      registrations](/review-registrations.md)).

## Business rules

- **Null means "hasn't rsvp'd", not zero.** The column is NULL by default
  and the page's field is empty; the first save sets it. 0 is a real,
  meaningful value ("none of my party is coming"), so the UI never writes
  null to clear an RSVP — empty input is refused and the saved number
  stands.
- **Range 0–8.** A party is at most eight people; the page validates first
  and the DB CHECK is the backstop for hand-crafted writes.
- **The headcount counts approved rows only, and null counts for zero.**
  The hosts' expected headcount is the sum of `party_size` over approved
  guests, with an unset (null) party size counted as 0 — a pending or
  rejected guest's number is shown in the table but never counted (the
  total and the column render in [Review registrations](/review-registrations.md)).
- **No un-RSVP.** v1 has no "clear my RSVP" action; a guest changes the
  number, they don't delete it.

## Depends on

- [users](../db/users.md) (the `party_size` column, the guard's
  self-writable rule, the CHECK)
- [RSVP party size](../api/rsvp-party-size.md) (the self-PATCH)
- [Current user state](../api/current-user-state.md) (the profile read that
  pre-fills the field)
- [Access by approval status](/access-by-approval-status.md) (the gating)
