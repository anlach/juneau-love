---
type: api-endpoint
title: List registrations (admin)
description: PostgREST read of all users rows that feeds the admin registrations table — display name, email, verified indicator, registration date, approval state, newest first.
status: draft
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-17T21:15:03Z }
---

# List registrations

Data source for the admin's registrations page
(`knowledge/stories/review-registrations.md`).

## Call

```js
// all registrations, newest first
supabase.from('users')
  .select('id, email, display_name, email_confirmed_at, status, created_at')
  .order('created_at', { ascending: false });

// optional pending-only filter
  .eq('status', 'pending');
```

## Caller and authorization

- Intended caller: signed-in admin. The FE gates the page on the
  `registrations:read` permission (fetched via
  `knowledge/api/current-user-state.md`).
- **RLS, not the FE, is the boundary:** the `admin_read_all` policy gives
  the admin every row. A non-admin calling the same query silently gets
  only their own row — a SELECT blocked by RLS returns a **filtered
  result, not an error**. The UI must therefore hide the page from
  non-admins; it must never treat "empty list" as a load failure.

## Expectations

- **Result:** `Array<{ id, email, display_name, email_confirmed_at,
  status, created_at }>`; `status ∈ { pending, approved, rejected }`.
  `email_confirmed_at === null` means the guest has not clicked the
  confirmation link yet — the FE renders a "not verified" state and keeps
  the Approve action unavailable (the function enforces the same rule).
- **Ordering:** `created_at` descending (most recent registration first).
- **Freshness:** the FE re-fetches after every approve/reject
  (`knowledge/api/registration-decision.md`) and on page focus.
- **Errors:** none expected from the DB for a valid session. Malformed
  requests surface as PostgREST 4xx. A signed-out caller gets zero rows
  (no anon policy).
