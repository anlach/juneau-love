---
type: design-decision
title: Gallery thumbnail rendering
description: "The gallery grid shows the client-generated WebP thumbnail at its natural aspect ratio — width-constrained, never cropped or stretched — and 'opening an image' is a plain link that opens the full-size original in a new tab. Rows without a thumbnail fall back to the full-size URL."
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-28T06:07:06Z }
---

# Gallery thumbnail rendering

How the [Guest gallery](../stories/guest-gallery.md) grid presents
images, and what "opening an image" means. Where thumbnails come from
and what size/quality they are is the business rule in the story; the
storage and URL contracts are in [assets](../db/assets.md) and
[asset-url](../api/asset-url.md).

## The grid shows the thumbnail, at its natural ratio

- The cell's `<img src>` is the presigned **thumbnail** URL from
  [asset-url](../api/asset-url.md); rows without a thumbnail fall back
  to the full-size `url` from the same call.
- Images render at **natural aspect ratio** in `.gallery-grid`
  (`width: 100%; height: auto`): the grid's `minmax(180px, 1fr)`
  constrains the width, the height follows the image. Photos come in
  different ratios, and the previous fixed 4:3 `object-fit: cover` box
  cropped or distorted them — no uniform box (operator requirement,
  2026-10-27).
- The hatched `.placeholder` (no presigned URL available) has no image
  to size from, so it keeps a fixed 4:3 box.
- Thumbnails are 800 px long edge (downscale-only), so at cell widths
  the browser still renders them slightly downscaled — sharp, without
  shipping full-size bytes for the grid.

## Opening an image

- "Open" is the **plain link** wrapping the cell's `<img>`: `href` is
  the full-size original's presigned URL, `target="_blank"
  rel="noopener"`. No lightbox in v1 — a new tab is the simplest
  presentation and it defers the full-size fetch to the moment a guest
  actually asks for it.
- The full-size URL comes from the same batched call and is already
  cached client-side (the [asset-url](../api/asset-url.md) frontend
  expectations), so opening costs no extra round trip to the function.

## Depends on

- [Shared components](/components.md) (`.gallery-grid`)
- [Guest gallery](../stories/guest-gallery.md)
- [assets](../db/assets.md), [asset-url](../api/asset-url.md)
