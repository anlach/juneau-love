---
type: api-endpoint
title: Current user state (own status + permissions)
description: "The two self-queries the layout runs after a session exists: the user's own users row (approval status) and their effective permission names from the user_permissions view."
status: draft
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-17T21:46:01Z }
---

# Current user state

Once a session exists, the layout resolves *what this user may see* with
two self-queries. These are UX plumbing: RLS still enforces everything
for real, and a failure here must degrade to "no access", never to
over-permissioning.

## Own approval status

```js
const { data } = await supabase
  .from('users')
  .select('id, email, display_name, status, created_at')
  .eq('id', user.id)
  .maybeSingle();
```

- RLS serves exactly the caller's own row (`users_read_own`).
- `status` drives the screen: `pending` → awaiting-approval screen,
  `rejected` → rejection screen, `approved` → guest content (see [Access
  by approval status](../stories/access-by-approval-status.md)).
- `data === null` is a data anomaly (auth user without a profile row —
  e.g. a broken manual insert): show an error state, do not guess.

## Own permissions

```js
const { data } = await supabase
  .from('user_permissions')
  .select('permission')
  .eq('user_id', user.id);

const can = (perm: string) => new Set(data.map(r => r.permission)).has(perm);
```

- Returns the caller's effective permission names via the
  [user_permissions](../db/user_permissions.md) view; RLS on the base
  tables guarantees a user can only see their own rows.
- v1 shape: an approved guest gets an **empty** set (the guest role has
  no permissions yet); an admin gets `registrations:read`,
  `registrations:approve`, `registrations:reject`.
- FE gating rules:
  - guest content → `status === 'approved'`
  - registrations page nav + actions → `can('registrations:read')` etc.

## When to fetch

- On session initialization in the root layout (`onAuthStateChange`
  `INITIALIZED`), and again after sign-in / sign-out events.
- A pending user's screen offers a manual "check status" re-fetch
  (polling is an open question, see the story).
