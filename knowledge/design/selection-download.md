---
type: component
title: Gallery selection & download UI
description: "Per-cell checkbox in the gallery grid (hover- or focus-revealed, always visible while any selection is active) and the Download button in the gallery toolbar — the presentation layer for the download flow."
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-29T17:21:04Z }
---

# Gallery selection & download UI

How [Download photos](../stories/download-photos.md) is presented.
What gets downloaded, the naming, and the zip rules are the business
rules in the story; this concept covers presentation only.

## Per-cell checkbox

- Every [`.gallery-grid`](/components.md) cell carries a native
  `<input type="checkbox">` (`.select`) absolutely positioned at the
  top-left of the image (0.45 rem inset, 1.25 rem box, `z-index: 1`),
  a sibling of — not inside — the open-link, so toggling never
  navigates.
- **Visibility is a presentation effect, not a gate:** `opacity: 0`
  by default; `opacity: 1` when the cell is `:hover`, when the grid
  carries the `selecting` class (any selection active), or when the
  box is `:focus-visible` — with a 120 ms opacity transition. The box
  is never `display: none` or `pointer-events: none`, so keyboard
  focus and touch taps reach it even while invisible; opacity is the
  only thing that changes.
- `aria-label` is `Select <caption> for download`, or `Select this
  photo for download` for rows without a caption.
- **Disabled while the cell has no signed URL** (storage backend
  unavailable in the environment): a row whose bytes can't be fetched
  can't be selected, but the box still appears on hover so the state
  is visible.

## Toolbar Download button

- The gallery toolbar (`.upload` row) gains a right-aligned
  `.download` group (`margin-left: auto`) after the upload controls:
  a `.btn.ghost` **Download** button, a muted `<N> selected` count
  (`.count`) shown only while selecting, and a `.msg.err` slot.
- **Disabled** when nothing is selected or a download is in flight
  (label swaps to `Preparing…`); the static `Download` name is the
  accessible name the toolbar is known by.
- A failed download shows its error in the group and **keeps the
  selection**, so retrying doesn't re-check boxes.

## Depends on

- [Shared components](/components.md) (`.gallery-grid`, `.btn`, `.msg`)
- [Gallery thumbnail rendering](/gallery-thumbnails.md)
- [Download photos](../stories/download-photos.md)
