---
type: api-endpoint
title: Current user state (own status + permissions)
description: "The self-query the layout runs after a session exists: the user's own users row (email, display name, approval status, confirmation and admin-notification stamps) with their roles nested in, from which permission names are derived; this state drives the nav, the approval gate, and the notify-registration fallback."
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-20T15:50:00Z }
---

# Current user state

Once a session exists, the layout resolves *what this user may see* with
a single self-query. This is UX plumbing: RLS still enforces everything
for real, and a failure here must degrade to "no access", never to
over-permissioning.

## The request

```
GET /rest/v1/users?id=eq.<uid>&select=id,email,display_name,status,email_confirmed_at,admin_notified_at,roles!user_roles(role_id.fk.users.id,name)
Authorization: Bearer <user JWT>
```

(`src/lib/session.svelte.ts`; the roles join is the `roles` alias of
[users](../db/users.md) `roles!user_roles(role_id.fk.users.id,name)` —
i.e. the user's role names through the `user_roles` join table, via
PostgREST FK embedding. `email` and `admin_notified_at` feed the
[notify-registration](/notify-registration.md) fallback — see below; the
layout never sends the row back to the server.)

```
{
  "id":        uuid,
  "email":     string | null,   // the user's own address (self row only)
  "display_name": string | null,
  "status":    'pending' | 'approved' | 'rejected',
  "email_confirmed_at": string | null,
  "admin_notified_at": string | null,  // set when the admins were alerted about this registration
  "roles":     [{ name: 'guest' | 'admin' }, ...]
}
```

## What the state drives

- **RLS serves exactly the caller's own row** (`users_read_own`).
- `status` drives the screen: `pending` → awaiting-approval screen,
  `rejected` → rejection screen, `approved` → guest content (see [Access
  by approval status](../stories/access-by-approval-status.md)).
- The `roles` names are mapped to permission names on the client
  (`ROLE_PERMISSIONS`, e.g. `admin` → `registrations:read/approve/reject`
  — the mapping lives in the FE only; server-side enforcement is in the
  edge functions, see [RBAC](../db/rbac.md)).
- FE gating rules:
  - guest content → `status === 'approved'`
  - registrations page nav + actions → `registrations:read` etc.
- **Notification fallback** — a layout `$effect` watches the profile and,
  while the user is signed in, `pending`, and has no `admin_notified_at`
  stamp, fires [notify-registration](/notify-registration.md)
  best-effort once (ref-guarded against loops). It covers a signup-time
  alert that never went through (tab closed). A failed send is not
  stamped server-side, so a later "check status" re-fetch fires it
  again; the function's own checks keep the alert idempotent.

## When to fetch

- On session initialization in the root layout (`onAuthStateChange`
  `INITIALIZED`), and again after sign-in / sign-out events.
- A pending user's screen offers a manual "check status" re-fetch
  (polling is an open question, see the story).

## Depends on

- [users](../db/users.md) (the row shape, RLS, guard)
- [RBAC](../db/rbac.md) (the role names → permissions mapping)
- [notify-registration](/notify-registration.md) (the fallback this
  profile feeds)
