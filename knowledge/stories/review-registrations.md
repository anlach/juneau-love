---
type: user-story
title: Review registrations (admin)
description: The admin opens a registrations page listing every registration with its verification and approval state, and can approve (verified emails only) or reject each one; approving emails the guest their login link. Admins are alerted to each new registration by email with approve/reject deep links into this page.
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-20T15:50:00Z }
---

# Review registrations

**As an** admin,
**I want to** see every registration in a table — display name, email,
date registered, whether the email is verified, and approval state — and
approve or reject each one,
**so that** only guests I vouch for get access to the site.

## Flow

1. Admin signs in (via the same login-link flow as everyone else —
   see [Sign in with a login link](/sign-in-with-login-link.md)); the
   layout fetches their state and sees the `registrations:read`
   permission → the registrations page appears in the nav (no other
   user can see it). In practice the admin is pointed here by the
   [notify-registration](../api/notify-registration.md) email, whose
   approve/reject buttons are deep links into this page
   (`?approve=<user_id>` / `?reject=<user_id>`).
2. The page loads all registrations, newest first, each row showing
   display name, email, `created_at`, a **verified indicator**
   (`email_confirmed_at` set or not), and current status
   (pending / approved / rejected).
3. On a `pending` row the admin chooses **approve** (available only for
   verified emails — the function enforces the same rule) or **reject**
   (always available), each gated by `registrations:approve` /
   `registrations:reject`.
4. The `registration-decision` edge function applies the decision
   atomically (status change + guest role grant/revoke in one
   transaction), and on approve generates a GoTrue login link and
   **emails the guest their link**; the list re-fetches and the row's
   status flips.
5. A deep link (from the notification email) does not apply anything by
   itself: the page shows a confirm banner for the linked row and the
   admin confirms there — same permission, transition, and
   verify-then-approve enforcement as the table buttons. An unknown or
   already-decided link gets a friendly notice instead of a banner.

## Acceptance criteria

- [ ] The page and its data are visible only to users with
      `registrations:read`; for everyone else the query returns only
      their own row (RLS), and the nav entry is absent.
- [ ] The table lists **all** registrations regardless of status, with
      the status and verified indicator clearly shown per row.
- [ ] Approve on a verified pending registration sets it to `approved`,
      grants the guest role, **and emails the guest their login link** (a
      GoTrue magiclink).
- [ ] Approve on an **unverified** registration is refused
      (`email_not_confirmed`) and the UI shows why; the admin can reject
      such rows.
- [ ] Reject sets it to `rejected`, revokes the guest role if present,
      and ends link eligibility (a previously emailed link may still be
      exchangeable briefly — RLS gives the rejected user nothing; see
      [Sign in with a login link](/sign-in-with-login-link.md)).
- [ ] Re-decisions follow the [transition table](../db/users.md#status-transitions)
      (nothing may go back to `pending`).
- [ ] A `?approve=<id>` / `?reject=<id>` deep link (the notification
      email's buttons) shows a confirm banner for that row; confirming
      goes through the same admin-gated decision as the table buttons,
      and an unknown/already-decided id shows a notice, not a banner.
- [ ] After any decision the list re-fetches; a double-click on approve
      is a harmless no-op (or a clean `invalid_transition` error).
- [ ] A non-admin cannot read other users' data by crafting the query
      themselves (RLS, not just hidden UI) — and no login credential is on
      `users` at all (links are GoTrue-owned tokens).

## Business rules

- **No self-service admin.** There is no UI or API that grants the admin
  role. The first admin is bootstrapped out-of-band via SQL (steps in
  [users](../db/users.md)); any further admin must be granted by an
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
- **New registrations alert the admins:** each new (pending)
  registration emails every admin the guest's details plus approve and
  reject deep links — at most one alert per registration, never re-alerted
  on re-decision (mechanics in [notify-registration](../api/notify-registration.md);
  the deep links are UX, the decision stays admin-gated).
- **Decisions are final-ish:** no undo action in v1 — an admin simply
  re-decides the row (`approved⇄rejected`).
- **No deletion** of registrations in v1 (no DELETE policy); rejected
  rows are left in place for the record.

## Depends on

- [users](../db/users.md), [RBAC](../db/rbac.md)
- [List registrations](../api/registration-list.md),
  [registration-decision](../api/registration-decision.md),
  [notify-registration](../api/notify-registration.md),
  [Current user state](../api/current-user-state.md)
