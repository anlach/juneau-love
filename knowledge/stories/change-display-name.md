---
type: user-story
title: Change display name
description: A signed-in user changes the name the site shows for them from a menu-reached page that looks like the registration card; the save is a self-update of users.display_name (the only user-writable column), the header and the DB row follow, and an empty name is refused.
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-24T16:41:54Z }
---

# Change display name

**As a** signed-in user,
**I want to** change my display name,
**so that** the site shows the name I actually go by — without an admin in
the loop.

## Flow

1. The signed-in header shows the display name (`.who`) next to a **menu
   button** (a stack of three lines) that replaces the old bare "Sign out"
   button. Its dropdown offers **Change Name** and **Sign Out**, and closes
   on outside click, Escape, or item click ([Shared
   components](../design/components.md)).
2. **Change Name** opens `/change-name` — a registration-card-look page
   with a single "Your name" field **prefilled** with the current name.
3. **Save name:** the FE refuses an empty (whitespace-only) name with
   "Please tell us your name." and sends no request; otherwise it [PATCHes
   `display_name` on the user's own row](/change-display-name.md).
4. A successful save shows a confirmation message and the client re-reads
   its own state, so the **header name updates without a reload**; the DB
   row carries the new name.
5. **Sign Out** (same menu) signs out and returns to the public home page —
   the previous bare-button behaviour.

## Acceptance criteria

- [ ] The signed-in nav offers a "Menu" button with a dropdown of "Change
      Name" and "Sign Out" — no bare "Sign out" button; the display name
      stays visible in the nav.
- [ ] `/change-name` is reachable from the menu and directly by URL
      (signed-in session required); its field is prefilled with the
      current name.
- [ ] Saving a new name updates `users.display_name` and the header name
      without a page reload.
- [ ] An empty/whitespace name is refused with a friendly message and the
      row unchanged.
- [ ] "Sign Out" from the menu signs the user out and lands on `/` with
      the anonymous nav.

## Business rules

- **`display_name` is the only user-writable column**, enforced by the
  [guard trigger](../db/users.md) — the page exists for it, and no other
  self-write is possible (hand-crafted updates of `status`,
  `email_confirmed_at`, `last_login_link_sent_at`, or `admin_notified_at`
  raise).
- **Not gated on approval status:** the guard and the RLS policy carry no
  `status` condition, so a `pending` user may change their name too — the
  name is identity, not access.
- **The name must stay non-empty** (the column is NOT NULL); the FE trims
  and validates before the call.
- Changing the name triggers no admin flow: no alert, no re-approval, no
  role change (the role-sync trigger watches `status` only).

## Depends on

- [users](../db/users.md) (self-update RLS policy, guard trigger)
- [Update own display name](/change-display-name.md) (the self-PATCH)
- [Shared components](../design/components.md) (the header menu, the card)
- [Access by approval status](access-by-approval-status.md) (what the
  header shows per state)
