---
type: user-story
title: Review registrations (admin)
description: The admin opens a registrations page listing every registration with its approval state, and can approve or reject each one.
status: draft
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-17T20:35:00Z }
---

# Review registrations

**As an** admin,
**I want to** see every registration in a table — display name, email,
date registered, approval state — and approve or reject each one,
**so that** only guests I vouch for get access to the site.

## Flow

1. Admin signs in; the layout fetches their state and sees the
   `registrations:read` permission → the registrations page appears in
   the nav (no other user can see it).
2. The page loads all registrations, newest first, each row showing
   display name, email, `created_at`, and current status
   (pending / approved / rejected).
3. On a `pending` row the admin chooses **approve** or **reject**
   (actions gated by `registrations:approve` / `registrations:reject`).
4. The update succeeds atomically (status change + guest role
   grant/revoke in one transaction); the list re-fetches and the row's
   status flips.

## Acceptance criteria

- [ ] The page and its data are visible only to users with
      `registrations:read`; for everyone else the query returns only
      their own row (RLS), and the nav entry is absent.
- [ ] The table lists **all** registrations regardless of status, with
      the status clearly shown per row.
- [ ] Approve on a pending registration sets it to `approved` **and**
      grants the guest role (one transaction, no partial state).
- [ ] Reject sets it to `rejected` and revokes the guest role if present.
- [ ] Re-decisions follow the transition table (`approved→rejected`,
      `rejected→approved` allowed; nothing may go back to `pending`).
- [ ] After any decision the list re-fetches; a double-click on approve
      is a harmless no-op.
- [ ] A non-admin cannot read other users' data by crafting the query
      themselves (RLS, not just hidden UI).

## Business rules

- **No self-service admin.** There is no UI or API that grants the admin
  role. The first admin is bootstrapped out-of-band via SQL (steps in
  `knowledge/db/users.md`); any further admin must be granted by an
  existing admin the same way. (Open question: an admin-promote action in
  the UI, with last-admin protection, later.)
- **An admin is also a guest:** the bootstrap leaves the admin holding
  both roles, so admins see guest content plus the admin page.
- **Decisions are final-ish:** no undo action in v1 — an admin simply
  re-decides the row (`approved⇄rejected`).
- **No notification** to the affected guest in v1 (open question).
- **No deletion** of registrations in v1 (no DELETE policy); rejected
  rows are left in place for the record.

## Depends on

- `knowledge/db/users.md`, `knowledge/db/user_roles.md`,
  `knowledge/db/role_permissions.md`
- `knowledge/api/registration-list.md`,
  `knowledge/api/registration-decision.md`,
  `knowledge/api/current-user-state.md`
