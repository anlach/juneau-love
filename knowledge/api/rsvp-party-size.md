---
type: api-endpoint
title: RSVP party size (self-update)
description: The self-PATCH a signed-in approved guest makes to set how many people in their party will attend the wedding and the whale watch — the guard trigger's self-writable RSVP columns; the page validates whole numbers 0–8 in both fields (and refuses empty) before sending, and null (no RSVP yet) is each column's default.
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-11-15T22:40:00Z }
---

# RSVP party size (self-update)

A signed-in approved guest saves how many people in their party will
attend the wedding and the whale watch by patching their own `users` row
directly — no edge function in the loop, same shape as [Update own
display name](/change-display-name.md). `party_size` and
`whale_watch_party_size` are the guard trigger's self-writable RSVP
columns, and the page saves both in one write.

## The request

```
PATCH /rest/v1/users?id=eq.<uid>
Authorization: Bearer <user JWT>
Content-Type: application/json

{ "party_size": 3, "whale_watch_party_size": 2 }
```

(`src/routes/rsvp/+page.svelte`; `<uid>` is the caller's own id —
RLS's `users_update_own` scopes the row to `auth.uid()`, so a different id
simply matches no row.)

## Rules

- **Null is the default; 0 is a value — per column.** Each column is
  NULL until the guest's first save ("hasn't rsvp'd"); 0 means "none of
  my party is coming" and is a normal save. The page never sends null —
  an emptied field is refused — so there is no un-RSVP in v1 (the saved
  numbers stand, and a refused field refuses the whole save).
- **One save writes both columns.** The two numbers travel in a single
  PATCH; a guest may register a different number per event (no
  double-counting — the hosts sum each column separately, see [Review
  registrations](../stories/review-registrations.md)).
- **FE validates first:** whole numbers 0 to 8 in **both** fields;
  out-of-range or empty input in either field shows the page's range
  message before anything is sent.
- **Approved guests only (UX gate).** The page renders the form only for
  an `approved` profile; `pending`/`rejected` see their state screens and
  anonymous visitors a sign-in prompt. Neither RLS nor the guard
  conditions on `status`, so the gate is UX, not security — an
  unapproved guest's numbers would only ever sit there uncounted (the
  headcounts sum approved rows).
- **DB backstops:** an out-of-range value in either column passes the
  guard and trips that column's CHECK constraint (`… is null or …
  between 0 and 8`, HTTP 400, row unchanged); a hand-crafted
  self-update of any other column raises `users: you may only change
  your own display_name, party_size, or whale_watch_party_size` from the
  guard.
- **On success the client re-reads its own state** ([Current user
  state](/current-user-state.md)), whose select includes both columns.
- **Admin side:** the registrations table renders each count per row
  (the Wedding and Whale columns) and sums each over approved rows for
  the per-event headcounts, counting null as 0 (see [List
  registrations](/registration-list.md)).

## Depends on

- [users](../db/users.md) (the columns, the CHECKs, the guard)
- [RSVP for the wedding and the whale watch](../stories/rsvp-party-size.md)
  (the flow, the business rules)
- [Current user state](/current-user-state.md) (the pre-fill read and the
  re-read after save)
