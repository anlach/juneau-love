---
type: user-story
title: Things to Do guide (guest content)
description: Approved guests get a "Things to Do in Juneau (Like a Local on a Budget)" guide page — Morgan's email, formatted — with the 2019 travel map embedded as a static PDF and a download link; approval-gated like all guest content.
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-25T20:58:00Z }
---

# Things to Do guide

**As an** approved guest,
**I want to** a page of Juneau tips plus the trip map,
**so that** I can plan my days and keep a copy of the map while I'm
there.

## Flow

1. The page is `/things-to-do` — guest content, so it follows the
   approval gate exactly like the [Guest gallery](/guest-gallery.md):
   anonymous → sign-in card, pending/rejected → the
   [Access by approval status](/access-by-approval-status.md) screens,
   approved → the guide. The header nav shows a "Things to Do" link for
   approved guests, next to "Photos".
2. The guide is Morgan's "Things to Do in Juneau (Like a Local on a
   Budget)" email, formatted: intro paragraphs, a gold-railed note, a
   "Take a hike!" section, and the main list (bold lead-ins, nested
   sub-lists for beaches, campgrounds, and museums, the NOAA tide-chart
   link).
3. Below the guide, the 2019 "Travel Juneau" map is embedded in an
   `<iframe>` and offered for download (`download` attribute) — both
   from the same static asset, `static/juneau-map.pdf`.

## Acceptance criteria

- [ ] Anonymous and pending visitors never see the guide or the map
      (e2e: `e2e/anonymous.spec.ts`, `e2e/pending-approval.spec.ts`).
- [ ] An approved guest reaches the page from the nav; the guide
      content (trail, museum, tide-chart link) and the embedded PDF
      render, and the download link points at the same file (e2e:
      `e2e/approved-guest.spec.ts`).
- [ ] The PDF is a committed static asset — no server, no storage
      bucket, no RLS involvement.

## Business rules

- **Content is verbatim:** the guide text is Morgan's, word-for-word,
  including her original spellings ("Campgroujd", "Mounain", "dowtown").
  The site reformats, it does not edit — any copy change comes from the
  couple, not the site.
- **The map is a static asset:** `static/juneau-map.pdf` (the "travel
  juneau map 2019 APR12.pdf" file), served by GitHub Pages like any
  other static file. The file itself is fetchable by URL without a
  session — accepted: it is a public tourism map, and the page (the
  gift) is what the gate protects.
- **Client-rendered** (`ssr = false`), like every gated route — see
  [What renders where](../design/prerender.md).

## Depends on

- [Access by approval status](/access-by-approval-status.md),
  [Guest gallery](/guest-gallery.md) (gating pattern)
- [What renders where](../design/prerender.md),
  [Shared components and conventions](../design/components.md)
