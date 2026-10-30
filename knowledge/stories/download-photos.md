---
type: user-story
title: Download photos
description: "Approved guests select gallery photos with checkboxes (hover-revealed per cell, all visible once a selection is active) and download them — one selection saves the original file directly, several save a single client-built zip."
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-29T17:21:04Z }
---

# Download photos

**As an** approved guest,
**I want to** save photos from the gallery to my device,
**so that** I can keep the images people have shared — by myself,
without asking the uploader.

## Flow

1. An approved guest opens the gallery ([Guest
   gallery](/guest-gallery.md)). Hovering a cell — or keyboard-focusing
   it — reveals a checkbox in the corner of the image
   ([Selection & batch-actions UI](../design/selection-actions.md)).
2. Checking a checkbox enables the **Download** button in the gallery
   toolbar and keeps **every** checkbox in the grid visible, so other
   photos can be selected without hovering each one. A `<N> selected`
   count appears next to the button; unchecking the last box returns
   to hover-only visibility and re-disables the button.
3. The guest clicks **Download**:
   - **one photo** → the browser fetches the presigned full-size URL
     the grid already caches and saves the original file directly —
     no zip wrapper;
   - **several** → the browser fetches all selected full-size URLs,
     builds a zip in memory (JSZip, `STORE` — images are already
     compressed), and saves `juneau-love-photos.zip`.
4. A failed download shows an error message and keeps the selection
   (retry without re-checking). The next gallery load prunes
   selections whose rows were removed out-of-band.

## Acceptance criteria

- [ ] The Download button is present but disabled while no photo is
      selected; enabled while one or more are selected; and disabled
      again once the last box is unchecked.
- [ ] A cell's checkbox is hidden until the cell is hovered or focused;
      while any selection is active, all checkboxes stay visible.
- [ ] Downloading a single selection saves the original, byte-identical,
      under a caption-derived filename with the `content_type`'s
      extension — not a zip.
- [ ] Downloading several selections saves one valid zip containing
      every selected original, each entry uniquely named.
- [ ] A cell without a signed URL (storage backend unavailable) cannot
      be selected; a download failure shows an error without losing
      the selection.
- [ ] No new endpoint, no schema change: the download reuses the
      grid's cached presigned URLs
      ([asset-url](../api/asset-url.md)).

## Business rules

- **The original is downloaded, never the thumbnail** — selecting
  means keeping a copy of the photo; the 800 px WebP is a grid artifact
  ([assets](../db/assets.md)).
- **Filename:** the caption, sanitized (path-unsafe characters removed,
  whitespace collapsed), or `photo` when the row has no caption, plus
  the extension of `content_type` (`jpeg → .jpg`). The `assets` row
  stores no uploaded filename (S3 keys are random), so the caption is
  the only human-meaningful name available. Duplicate names within one
  batch get a `-<first 8 hex of asset id>` suffix, then `-2`, `-3`, …
- **The zip is built in the client** — there is no server-side zip:
  `adapter-static` has no runtime server, and the project's settled
  architecture keeps edge functions light and stateless
  ([asset-url](../api/asset-url.md)). JSZip's default `STORE` is used
  deliberately: deflating already-compressed images would burn CPU for
  no size gain.
- **Bytes come from the cached presigned URLs.** The S3 endpoint
  answers any-origin fetches (`Access-Control-Allow-Origin: *`), so
  the browser can read full-size bytes without new credentials or an
  endpoint. Visibility is unchanged: a guest can only download rows
  their RLS already allows them to see — [asset-url](../api/asset-url.md)
  signs only those rows.
- **No count or total-size limit in v1:** the 5 MB per-image upload
  cap bounds a single file, but a large selection temporarily holds
  every selected original in browser memory.
- **Download is not a sharing channel:** saving to one's own device is
  the guest's own copy — no re-upload path is added by this feature.

## Depends on

- [Guest gallery](/guest-gallery.md)
- [Selection & batch-actions UI](../design/selection-actions.md)
- [assets](../db/assets.md), [asset-url](../api/asset-url.md)
