---
type: component
title: Shared components and conventions
description: "The class-based component kit in src/app.css (frame/header/nav, card, buttons, fields, messages, badges, table, gallery grid, the header account menu) plus the StateScreen component for the signed-in status screens."
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-24T16:41:54Z }
---

# Shared components

The UI is intentionally a small class kit in `src/app.css` (no component
library); Svelte components stay thin and reference these classes. Tokens
lived here: [Design tokens](/tokens.md).

## Site chrome (root layout)

- `header.site-header.frame`: brand (`juneau.love`, `.display`, gold
  `.`) on the left, `nav.site-nav` on the right.
- Nav content is gated by auth state (the *rules* — which links appear for
  which status/permission — are the business rule in [Access by approval
  status](../stories/access-by-approval-status.md), not here):
  - signed out → "Sign in" + "Register" (both plain nav links — no
    button styling in the nav)
  - ready → "Photos" (approved only), "Registrations"
    (`registrations:read` only), the display name (`.who`, italic muted),
    an **account menu**: `.menu-btn` (a stack of three lines, `aria-label`
    `"Menu"`, `aria-haspopup="menu"`) toggles a `.menu` dropdown
    (`role="menu"`) of `.menu-item` entries — "Change Name" (link to
    `/change-name`) and "Sign Out" (signs out, redirects home — the old
    bare-button behaviour). The menu closes on outside click, Escape, and
    item click ([Change display name](../stories/change-display-name.md))
- The root layout also owns `initAuth()` on mount and the favicon.

## Building blocks

| Class | Purpose | Conventions |
|---|---|---|
| `.card` | Centered content panel (forms, status screens) | max-width 480px, plum-lilac fill (`--bg-elevated`), hairline gold border; add `.center` for centered copy |
| `.btn` | Primary action (pill) | `.ghost` = secondary, `.danger` = destructive, `.small` = nav-sized; `disabled` while a request is in flight; button-styled `<a>`s own their text colour — the generic link style is scoped `a:not(.btn)` so it can't override `.btn` on hover |
| `.field` | Form label + input (label wraps input) | inputs are full-width; **forms that do their own validation carry `novalidate`** — without it the browser's `type=email` constraint validation swallows the submit before the Svelte handler runs |
| `.msg` | Inline feedback line | `.msg.ok` (sage) / `.msg.err` (terracotta-peach mix); interactive feedback also gets `role="alert"` (one-shot) or `role="status"` (may update) |
| `.badge` | Approval-state chip in the registrations table | `.pending` / `.approved` / `.rejected` tint the background |
| `.table` | Data table (registrations) | header row in `.muted`, hairline row separators, `.actions` cell right-aligned with small buttons |
| `.gallery-grid` | Photo grid | auto-fill `minmax(180px, 1fr)`; 4:3 `object-fit: cover` images; hatched `.placeholder` when no presigned URL is available; caption shows uploader (italic) + caption |
| `.spread` | Row of actions under a card | centered, wrapping |
| `.menu-btn` / `.menu` / `.menu-item` | Header account menu (icon button + dropdown) | button toggles `aria-expanded`; dropdown is `role="menu"` positioned absolute below the button (`--bg-elevated` fill, hairline gold border, same shadow as `.card`); entries are full-width `role="menuitem"`, hover tinted with a gold mix |

## StateScreen (src/lib/components/StateScreen.svelte)

One shared component renders the three signed-in non-content screens
(`status: 'pending' | 'rejected' | 'error'`, optional display name and error
message). It is used by every gated route (`/`, `/gallery`,
`/registrations`) so the screens stay consistent.

- `pending`: "you're on the list" + a **Check status** button that re-runs
  `refreshState()` — the manual re-fetch behaviour is the business rule in
  [Access by approval status](../stories/access-by-approval-status.md).
- `rejected`: rejection message, no actions.
- `error`: shows the fetch error with a **Try again** button — a failed
  state fetch must never reveal content (defense in depth).

The "sign in to continue" (anonymous) and "not available to you"
(non-admin) screens are inline in their routes — they are one-offs, not
part of the state machine.

## Change-name page (/change-name)

The display-name self-edit page deliberately looks like the registration
card — `.card`, `.display` h2, one `.field`, `.msg` feedback, `.btn` save.
One field, one action. It is gated on a signed-in session, **not** on
approval status (any signed-in user, including `pending`, may edit the
name — the business rule in [Change display name]
(../stories/change-display-name.md)); anonymous visitors get a sign-in
card, and the field is prefilled from the profile once it has loaded.

## Depends on

- [Design tokens](/tokens.md)
- [Access by approval status](../stories/access-by-approval-status.md)
- [Guest gallery](../stories/guest-gallery.md) (gallery grid),
  [Review registrations](../stories/review-registrations.md) (table),
  [Change display name](../stories/change-display-name.md) (account menu,
  change-name page)
