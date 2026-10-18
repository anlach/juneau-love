---
type: user-story
title: Access by approval status
description: A signed-in user's screen is determined by their approval state — pending sees an awaiting screen, rejected sees a rejection screen, approved sees guest content (admins additionally the registrations page); sessions last via 1-day access + 1-year refresh tokens.
status: draft
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-17T21:46:01Z }
---

# Access by approval status

**As a** registered guest,
**I want to** my access to reflect my approval state as soon as an admin
decides,
**so that** I only see the site once I'm in, and I know what's going on
while I wait.

## Flow

1. The user gets a session the only two ways there are: clicking the
   email-confirmation link (at registration, step 1) or clicking a
   login link (after approval, step 2 / any recovery). See
   [Sign in with a login link](/sign-in-with-login-link.md).
2. The layout fetches current-user state (own `users` row + permissions)
   and routes:

| Status | Screen |
|---|---|
| signed out | public landing page (register CTA + sign-in email form) |
| confirmed, `pending` | "awaiting approval" screen: friendly message, display name, a "check status" button that re-fetches |
| `rejected` | rejection screen: the registration was not approved; no content, no re-registration path |
| `approved` | guest content. If `registrations:read` is present, the nav also shows the registrations page (see [Review registrations](/review-registrations.md)) |

3. A pending user who gets approved sees guest content on their next
   "check status" / refresh — the session they got from the
   email-confirmation step already works, so on *that browser* approval
   is immediate; on any **other** device the login link is still the way
   in. (v1: no push/poll.)

## Acceptance criteria

- [ ] The correct screen shows for each status, including a brand-new
      (confirmed, pending) and an admin (approved + permissions) account.
- [ ] No user-specific or approval-specific data appears in prerendered
      HTML — the site is `adapter-static`, so every such screen renders
      client-side after the session/state fetch.
- [ ] A state fetch failure (null row, network error) renders an error
      state with **no** site content — never the reverse.
- [ ] Gating is defense in depth: hiding the UI is UX; RLS on
      `users` / `user_roles` / the permission view is what actually
      protects the data.

## Business rules

- **Status drives the user-facing state; roles/permissions drive
  capabilities.** `pending`/`rejected` users hold no roles at all; the
  guest role exists exactly when `status = 'approved'`.
- **v1 guest permissions are empty:** guest-content access is keyed on
  `status = 'approved'`, while admin capabilities are keyed on
  permissions (`registrations:*`).
- **Sessions:** 1-day access token, 1-year refresh token; supabase-js
  auto-refreshes and persists in localStorage. A returning visitor with a
  valid refresh token needs no link at all — the login link is the
  re-authentication path, not the session mechanism.
- **No auto-refresh in v1:** the pending screen offers a manual
  "check status" fetch; background polling is an open question.
- **Notifications:** approval emails the guest their login link (in
  scope — the `registration-decision` function). Rejection sends nothing
  in v1 (open question).

## Depends on

- [users](../db/users.md), [user_permissions](../db/user_permissions.md)
- [Current user state](../api/current-user-state.md),
  [Client authentication](../api/client-auth.md)
- [Sign in with a login link](/sign-in-with-login-link.md)
