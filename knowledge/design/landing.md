---
type: design-decision
title: Landing page (variants and photoshoot collage)
description: "The / page renders one of four variants by session state — public invitation hero (the prerendered one), the approved welcome/RSVP card with the photoshoot collage underneath, and the shared StateScreen screens. The collage is a committed static WebP shown at its natural size (overflow accepted on narrow screens)."
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-11-03T04:11:46Z }
---

# Landing page (/)

One route, four variants, chosen by session state (gating *rules* in
[Access by approval status](../stories/access-by-approval-status.md);
*why* only the public one ships in prerendered HTML in [What renders
where](/prerender.md)):

| State | What renders |
|---|---|
| anonymous (incl. pre-hydration) | Public invitation hero: "morgan & andrew" kicker, "You’re invited" in `.display`, muted sub-copy, Register + "I have an account" buttons |
| approved | Welcome card (`.card.center`, "Welcome, {name}" in `.display`) with the RSVP button (+ "Review registrations" for `registrations:read`), then the [photoshoot collage](#photoshoot-collage) below it |
| pending / rejected / error | The shared `StateScreen` ([Shared components](/components.md)) |

## Photoshoot collage

Underneath the welcome/RSVP card in the approved variant:

- Committed static asset `static/images/collage.webp` (810×770) — **not**
  Supabase storage: a decorative site asset needs no presign/RLS
  machinery, same pattern as `static/juneau-map.pdf` on the things-to-do
  page ([Shared components](/components.md#things-to-do-page--things-to-do)).
  Stored as WebP, the site's image format (1 MB PNG source → ~136 KB),
  consistent with [Gallery thumbnail rendering](/gallery-thumbnails.md).
- Layout: centered, shown at its **natural 810×770 size — no
  `max-width`, no scaling** (the image is never resized). It sits in a
  centered flex row (`.collage-row`, `justify-content: center`), so on
  viewports narrower than 810px it overflows `.frame` **equally on both
  sides** instead of shrinking — the outer slivers are then unreachable
  by horizontal scrolling; accepted. 12px radius to match the card
  corners.
- It is content, not decoration: alt text describes the couple
  ("Morgan and Andrew in a collage of their photoshoot"), and explicit
  `width`/`height` attributes keep the layout stable while it loads.
- Because the approved variant never appears in prerendered HTML, only
  approved (client-side) sessions ever request the image.

## Depends on

- [What renders where (prerendered vs client-rendered)](/prerender.md)
- [Shared components and conventions](/components.md)
- [Gallery thumbnail rendering](/gallery-thumbnails.md)
- [Access by approval status](../stories/access-by-approval-status.md)
