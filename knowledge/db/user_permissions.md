---
type: db-table
title: user_permissions
description: Read-only view resolving each user's effective permission names (user_roles x role_permissions x permissions). The FE queries it for the current user to gate the UI.
status: draft
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-17T21:46:01Z }
---

# user_permissions

A **view** (not a table) that flattens the RBAC joins into one row per
(user, permission). It is the single query the FE uses to build the
current user's permission set
([Current user state](../api/current-user-state.md)).

# Schema

| Column | Type | Description |
|---|---|---|
| `user_id` | `uuid` | From [user_roles](/user_roles.md). |
| `permission` | `text` | The permission `name` from [permissions](/permissions.md). |

Target DDL:

```sql
create view public.user_permissions as
select ur.user_id,
       p.name as permission
from public.user_roles ur
join public.role_permissions rp on rp.role_id = ur.role_id
join public.permissions p       on p.id = rp.permission_id;
```

# Access patterns

- **Read via PostgREST:** `select permission from user_permissions where
  user_id = <self>` → the set of permission names the FE turns into a
  `can(...)` helper. Read-only; PostgREST never exposes writes on views.
- **Admin nuance:** because [user_roles](/user_roles.md) grants the admin
  SELECT on *all* users' rows, an admin querying the view can enumerate
  any user's effective permissions. Intended (useful on the registrations
  page); do not widen this further.
- **v1 gap:** an approved guest's set is **empty** (the guest role has no
  permissions); guest-facing gating keys off approval state, not
  permissions — see [Access by approval
  status](../stories/access-by-approval-status.md).
- **No independent RLS on the view:** it is a security invoker, so the
  base tables' RLS ([user_roles](/user_roles.md),
  [role_permissions](/role_permissions.md), [permissions](/permissions.md))
  filters the result — a guest only ever sees their own rows.

# RLS

None needed (and not applicable beyond the base-table policies above).
The base-table RLS is what makes the view safe; document any change to
[role_permissions](/role_permissions.md) RLS here as well.
