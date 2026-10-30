---
type: component
title: Gallery selection & batch-actions UI
description: "Per-cell checkbox in the gallery grid (hover- or focus-revealed, always visible while any selection is active) and the toolbar action group — Download, plus Delete with its own enablement — the presentation layer for both batch actions."
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-30T05:55:00Z }
---

# Gallery selection & batch-actions UI

How [Download photos](../stories/download-photos.md) and [Delete
photos](../stories/delete-photos.md) are presented. What gets
downloaded, the naming, the zip rules, and who may delete what are the
business rules in the stories; this concept covers presentation only.

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
- `aria-label` is `Select <caption>` (or `Select this photo` for rows
  without a caption) — deliberately action-neutral, because one
  selection drives both Download and Delete.
- **Disabled while the cell has no signed URL** (storage backend
  unavailable in the environment): a row whose bytes can't be fetched
  can't be selected, but the box still appears on hover so the state
  is visible.

## Toolbar action group

- The gallery toolbar (`.upload` row) carries a right-aligned
  `.actions` group (`margin-left: auto`) after the upload controls:
  a `.btn.ghost` **Download** button, a `.btn.ghost.danger` **Delete**
  button, a muted `<N> selected` count (`.count`) shown only while
  selecting, and one `.msg` slot per action.
- **Download** is disabled while nothing is selected or a download is
  in flight (label swaps to `Preparing…`).
- **Delete** is disabled unless *every* selected row is deletable by
  the caller — own rows, or any row for an admin (the RLS rule in
  [assets](../db/assets.md)) — plus while a deletion is in flight
  (label swaps to `Deleting…`). A guest selecting photos they didn't
  upload therefore sees Delete stay greyed; the frontend gate is UX
  only, the backend is the boundary.
- Delete asks one `confirm()` for the whole batch before the request
  goes out.
- A failed action shows its error in the group and **keeps the
  selection** (on partial success only the rows that actually went are
  dropped), so retrying doesn't re-check boxes.

## Depends on

- [Shared components](/components.md) (`.gallery-grid`, `.btn`, `.msg`)
- [Gallery thumbnail rendering](/gallery-thumbnails.md)
- [Download photos](../stories/download-photos.md)
- [Delete photos](../stories/delete-photos.md)
