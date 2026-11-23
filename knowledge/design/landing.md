---
type: design-decision
title: Landing page (variants and photoshoot collage)
description: "The / page renders one of five variants by session state — a neutral loading line while the session resolves (the prerendered one, which holds the public hero back so it never flashes before a returning guest's welcome card), the public invitation hero, the approved welcome/RSVP card with the photoshoot collage underneath, and the shared StateScreen screens. The collage is a committed static WebP that scales down to fit the page width on narrow screens."
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-11-23T02:28:30Z }
---

# Landing page (/)

One route, five variants, chosen by session state (gating *rules* in
[Access by approval status](../stories/access-by-approval-status.md);
*why* the loading line is the prerendered shell in [What renders
where](/prerender.md)):

| State | What renders |
|---|---|
| loading (pre-hydration, and while the session + approval state resolve) | A neutral "Loading…" line, centered. The public invitation is deliberately held back here: a returning signed-in guest must not see "You're invited" flash for a moment before their welcome card. This branch is also what prerendering emits ([What renders where](/prerender.md)) |
| anonymous | Public invitation hero: “morgan & andrew” kicker, “You’re invited” in `.display`, muted sub-copy, Register + “I have an account” buttons |
| approved | Welcome card (`.card.center`, "Welcome, {name}" in `.display`) with the RSVP button (+ "Review registrations" for `registrations:read`), then the [photoshoot collage](#photoshoot-collage) below it |
| pending / rejected / error | The shared `StateScreen` ([Shared components](/components.md)) |

## Photoshoot collage

Underneath the welcome/RSVP card in the approved variant:

- Committed static asset `static/images/collage.webp` (563×597) — **not**
  Supabase storage: a decorative site asset needs no presign/RLS
  machinery, same pattern as `static/juneau-map.pdf` on the things-to-do
  page ([Shared components](/components.md#things-to-do-page--things-to-do)).
  Stored as WebP, the site's image format (422 KB PNG source → ~48 KB),
  consistent with [Gallery thumbnail rendering](/gallery-thumbnails.md).
- Layout: centered in a flex row (`.collage-row`,
  `justify-content: center`), shown at its natural 563×597 size but
  capped by `max-width: 100%` + `height: auto` — on viewports narrower
  than 563px it scales down proportionally to fit the frame instead of
  overflowing. 12px radius to match the card corners.
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
