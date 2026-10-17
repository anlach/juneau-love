---
type: api-endpoint
title: Approve / reject a registration
description: Admin sets a user's status to approved or rejected via a PostgREST update; DB triggers enforce the transition and grant or revoke the guest role in the same transaction.
status: draft
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-17T20:35:00Z }
---

# Approve / reject a registration

The admin's decision action on the registrations page
(`knowledge/stories/review-registrations.md`).

## Call

```js
supabase.from('users')
  .update({ status: 'approved' })   // or 'rejected'
  .eq('id', targetUserId);
```

Send **only** `status`; the guard trigger forces `updated_at = now()`.

## Caller and authorization

- FE gate: `registrations:approve` or `registrations:reject` permission.
- DB enforcement (two layers, see `knowledge/db/users.md`):
  - RLS: only the admin role may UPDATE other users' rows.
  - Trigger: the transition must be legal (`pending→approved`,
    `pending→rejected`, `approved→rejected`, `rejected→approved`);
    anything else — including a non-admin changing any status — raises.

## Side effects (same transaction)

- `approved` → the sync trigger upserts the user's `guest` role row.
- `rejected` → the sync trigger deletes the user's `guest` role row.

So the decision and the capability change are atomic; there is no window
where an approved user lacks the role (or vice versa).

## Expectations and errors

- **Success:** 204/200. The FE re-fetches the registrations list
  (`knowledge/api/registration-list.md`); the row's status flips and, for
  approvals, the guest's next sign-in (or refresh) yields guest access.
- **No-op:** deciding on an already-decided row is harmless
  (same-status update, no role churn) — safe against double-clicks.
- **Unknown `targetUserId`:** 200 with zero rows affected. The FE checks
  the response length and re-fetches the list.
- **Invalid transition or non-admin:** PostgREST 400 carrying the
  trigger's message (e.g. `only an admin may change registration status`).
  The FE shows the message and re-fetches; it should not happen if the
  UI only offers legal actions.
