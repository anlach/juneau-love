---
type: api-endpoint
title: RSVP party size (self-update)
description: The self-PATCH a signed-in approved guest makes to set how many people in their party will attend — the guard trigger's second self-writable column; the page validates whole numbers 0–8 (and refuses empty) before sending, and null (no RSVP yet) is the column's default.
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-11-01T16:33:44Z }
---

# RSVP party size (self-update)

A signed-in approved guest saves how many people in their party will attend
by patching their own `users` row directly — no edge function in the loop,
same shape as [Update own display name](/change-display-name.md).
`party_size` is the guard trigger's second self-writable column.

## The request

```
PATCH /rest/v1/users?id=eq.<uid>
Authorization: Bearer <user JWT>
Content-Type: application/json

{ "party_size": 3 }
```

(`src/routes/rsvp/+page.svelte`; `<uid>` is the caller's own id —
RLS's `users_update_own` scopes the row to `auth.uid()`, so a different id
simply matches no row.)

## Rules

- **Null is the default; 0 is a value.** The column is NULL until the
  guest's first save ("hasn't rsvp'd"); 0 means "none of my party is
  coming" and is a normal save. The page never sends null — empty input is
  refused — so there is no un-RSVP in v1 (the saved number stands).
- **FE validates first:** whole numbers 0 to 8 only; out-of-range or empty
  input shows the page's range message before anything is sent.
- **Approved guests only (UX gate).** The page renders the form only for an
  `approved` profile; `pending`/`rejected` see their state screens and
  anonymous visitors a sign-in prompt. Neither RLS nor the guard conditions
  on `status`, so the gate is UX, not security — an unapproved guest's
  number would only ever sit there uncounted (the headcount sums approved
  rows).
- **DB backstops:** an out-of-range value passes the guard and trips the
  CHECK constraint (`party_size is null or party_size between 0 and 8`,
  HTTP 400, row unchanged); a hand-crafted self-update of any other column
  raises `users: you may only change your own display_name or party_size`
  from the guard.
- **On success the client re-reads its own state** ([Current user
  state](/current-user-state.md)), whose select includes `party_size`.
- **Admin side:** the registrations table renders `party_size` per row and
  sums it over approved rows for the expected headcount, counting null as
  0 (see [List registrations](/registration-list.md)).

## Depends on

- [users](../db/users.md) (the column, the CHECK, the guard)
- [RSVP with a party size](../stories/rsvp-party-size.md) (the flow, the
  business rules)
- [Current user state](/current-user-state.md) (the pre-fill read and the
  re-read after save)
