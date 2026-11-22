---
type: user-story
title: Whale watch page (guest content)
description: "Approved guests get a whale-watch info page for Friday, June 18, 2027 — the day before the wedding — meet at Statter Harbor by 2:45 PM, 3:00 PM departure, back at Statter Harbor by 6:00 PM, room for up to 120; with an RSVP button into the shared RSVP page; approval-gated like all guest content."
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-11-15T22:40:00Z }
---

# Whale watch page

**As an** approved guest,
**I want to** see when and where the whale watch is,
**so that** I can plan the day before the wedding and know who's coming.

## Flow

1. The page is `/whale-watching` — guest content, so it follows the
   approval gate exactly like the [Guest gallery](/guest-gallery.md):
   anonymous → sign-in card, pending/rejected → the
   [Access by approval status](/access-by-approval-status.md) screens,
   approved → the plan. The header nav shows a "Whale Watch" link for
   approved guests (between "Photos" and "Things to Do"); the landing
   card offers no button for it — it is also linked from the RSVP page's
   intro line.
2. The page is intentionally thin: the date ("Friday, June 18, 2027 · the
   day before"), the plan as three bullets (2:45 PM meet at Statter
   Harbor, 3:00 PM departure, 6:00 PM back at Statter Harbor), a note
   that there's room for up to 120, and an **RSVP** button linking to
   the shared [RSVP page](/rsvp-party-size.md), where the whale-watch
   count is actually collected.

## Acceptance criteria

- [ ] Anonymous and pending/rejected visitors never see the plan (e2e:
      `e2e/whale-watching.spec.ts`).
- [ ] An approved guest reaches the page from the nav (and the RSVP
      page's link); the date, the three plan bullets, the Statter Harbor
      locations, and the up-to-120 note render, and the RSVP button links
      to `/rsvp` (e2e: `e2e/whale-watching.spec.ts`).
- [ ] The page carries no user-specific or approval-specific data — the
      gating is client-side UX only, which is acceptable because the plan
      itself isn't sensitive (see
      [What renders where](../design/prerender.md)).

## Business rules

- **The schedule:** guests arrive at Statter Harbor by **2:45 PM**, the
  departure is **3:00 PM**, and the whale watch ends at **6:00 PM** back
  at Statter Harbor (it begins and ends at the same harbor).
- **The date is the day before the wedding:** Friday, June 18, 2027 (the
  wedding is Saturday, June 19, 2027).
- **Capacity:** up to 120 people can come along — the page says so so
  guests don't hold back.
- **The count lives on the RSVP page, not here:** the page only informs;
  the whale-watch party size is saved via the shared RSVP form's second
  field (business rules in [RSVP for the wedding and the whale
  watch](/rsvp-party-size.md)).
- **Client-rendered**, like every gated route — see
  [What renders where](../design/prerender.md).

## Depends on

- [Access by approval status](/access-by-approval-status.md),
  [Guest gallery](/guest-gallery.md) (gating pattern)
- [RSVP for the wedding and the whale watch](/rsvp-party-size.md) (the
  count this page points at)
- [What renders where](../design/prerender.md),
  [Shared components and conventions](../design/components.md)
