---
type: user-story
title: Review registrations (admin)
description: The admin opens a registrations page listing every registration with its verification and approval state, and can approve (verified emails only) or reject each one; approving emails the guest their login link.
status: draft
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-17T21:15:03Z }
---

# Review registrations

**As an** admin,
**I want to** see every registration in a table — display name, email,
date registered, whether the email is verified, and approval state — and
approve or reject each one,
**so that** only guests I vouch for get access to the site.

## Flow

1. Admin signs in (via the same passcode-link flow as everyone else —
   see `knowledge/stories/sign-in-with-login-link.md`); the layout
   fetches their state and sees the `registrations:read` permission →
   the registrations page appears in the nav (no other user can see it).
2. The page loads all registrations, newest first, each row showing
   display name, email, `created_at`, a **verified indicator**
   (`email_confirmed_at` set or not), and current status
   (pending / approved / rejected).
3. On a `pending` row the admin chooses **approve** (available only for
   verified emails — the function enforces the same rule) or **reject**
   (always available), each gated by `registrations:approve` /
   `registrations:reject`.
4. The `registration-decision` edge function applies the decision
   atomically (status change + guest role grant/revoke + passcode
   issue/revoke in one transaction) and, on approve, **emails the guest
   their login link**; the list re-fetches and the row's status flips.

## Acceptance criteria

- [ ] The page and its data are visible only to users with
      `registrations:read`; for everyone else the query returns only
      their own row (RLS), and the nav entry is absent.
- [ ] The table lists **all** registrations regardless of status, with
      the status and verified indicator clearly shown per row.
- [ ] Approve on a verified pending registration sets it to `approved`,
      grants the guest role, issues a fresh 7-day passcode, **and emails
      the guest the login link**.
- [ ] Approve on an **unverified** registration is refused
      (`email_not_confirmed`) and the UI shows why; the admin can reject
      such rows.
- [ ] Reject sets it to `rejected`, revokes the guest role if present,
      and kills any unredeemed login link immediately.
- [ ] Re-decisions follow the transition table (`approved→rejected`,
      `rejected→approved` allowed; nothing may go back to `pending`).
- [ ] After any decision the list re-fetches; a double-click on approve
      is a harmless no-op (or a clean `invalid_transition` error).
- [ ] A non-admin cannot read other users' data by crafting the query
      themselves (RLS, not just hidden UI) — and can never see anyone's
      passcode (it isn't on `users`).

## Business rules

- **No self-service admin.** There is no UI or API that grants the admin
  role. The first admin is bootstrapped out-of-band via SQL (steps in
  `knowledge/db/users.md`); any further admin must be granted by an
  existing admin the same way. (Open question: an admin-promote action in
  the UI, with last-admin protection, later.)
- **An admin is also a guest:** the bootstrap leaves the admin holding
  both roles, so admins see guest content plus the admin page. The admin
  logs in through the normal sign-in page — no special path.
- **Verify-then-approve:** gate 1 (email confirmed) must pass before
  gate 2 (approval). The UI surfaces the verified state; the
  `registration-decision` function enforces it.
- **Approving is a notification:** the guest's only post-approval signal
  is the login-link email. If that email fails to send, the decision
  still stands (`email_sent: false`) and the guest (or a future "resend"
  button) can trigger `send-login-link`.
- **Decisions are final-ish:** no undo action in v1 — an admin simply
  re-decides the row (`approved⇄rejected`).
- **No deletion** of registrations in v1 (no DELETE policy); rejected
  rows are left in place for the record.

## Depends on

- `knowledge/db/users.md`, `knowledge/db/login_passcodes.md`,
  `knowledge/db/user_roles.md`, `knowledge/db/role_permissions.md`
- `knowledge/api/registration-list.md`,
  `knowledge/api/registration-decision.md`,
  `knowledge/api/current-user-state.md`
