---
type: user-story
title: Access by approval status
description: A signed-in user's screen is determined by their approval state — pending sees an awaiting screen, rejected sees a rejection screen, approved sees guest content (admins additionally the registrations page).
status: draft
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-17T20:35:00Z }
---

# Access by approval status

**As a** registered guest,
**I want to** my access to reflect my approval state as soon as an admin
decides,
**so that** I only see the site once I'm in, and I know what's going on
while I wait.

## Flow

1. User signs in (any status can sign in — auth and approval are
   separate).
2. The layout fetches current-user state (own `users` row + permissions)
   and routes:

| Status | Screen |
|---|---|
| signed out | public landing page (registration CTA) |
| `pending` | "awaiting approval" screen: friendly message, display name, a "check status" button that re-fetches |
| `rejected` | rejection screen: the registration was not approved; no content, no re-registration path |
| `approved` | guest content. If `registrations:read` is present, the nav also shows the registrations page (see `knowledge/stories/review-registrations.md`) |

3. A pending user who gets approved sees guest content after
   sign-out/sign-in or a refresh (v1: no push/poll).

## Acceptance criteria

- [ ] The correct screen shows for each status, including a brand-new
      (pending) and an admin (approved + permissions) account.
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
- **No auto-refresh in v1:** the pending screen offers a manual
  "check status" fetch; background polling is an open question.
- **Email notifications on decision are out of scope** (would need an
  edge function with the service role).

## Depends on

- `knowledge/db/users.md`, `knowledge/db/user_permissions.md`
- `knowledge/api/current-user-state.md`, `knowledge/api/client-auth.md`
