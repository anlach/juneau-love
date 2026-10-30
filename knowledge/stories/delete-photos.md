---
type: story
title: Delete photos
description: "A guest can delete the photos they uploaded, and an admin can delete any photo — batched over the same selection as download, confirmed once, with the backend enforcing the same rule as the UI gate."
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-30T05:55:00Z }
---

# Delete photos

## Business rules

- **Who may delete what:** the uploader of a photo, or an admin. The
  boundary is the [assets RLS DELETE policy](../db/assets.md)
  (`is_approved()` and (own row or `admin` role)) — enforced in
  Postgres, not in the function or the UI.
- **The selection drives the action:** the same per-cell selection as
  [download](download-photos.md) drives Delete. The Delete button
  enables only when *every* selected row is deletable by the caller —
  a guest selecting a photo they didn't upload keeps it disabled
  ([presentation](../design/selection-actions.md)).
- **Confirm once per batch:** one `confirm()` naming the count; the
  delete is final (no trash, no undo) and the message says so.
- **Partial success is honest:** the response lists only the rows
  that actually went ([contract](../api/asset-delete.md)); the UI
  drops exactly those and keeps the rest selected for a retry.
- **Storage cleanup, row first:** the S3 original and thumbnail are
  removed after the row, best-effort. A failed object delete leaves an
  invisible orphan (private bucket) — tolerated in v1, reclaimable out
  of band.

## User flow

1. In the [gallery](guest-gallery.md), select one or more of your own
   photos (or, as an admin, any photo).
2. Click **Delete** in the toolbar and confirm the dialog.
3. The deleted cells drop out of the grid; a success message reports
   the count, or an error message keeps the selection for a retry.

## Depends on

- [Guest gallery](guest-gallery.md)
- [Download photos](download-photos.md) (shared selection)
- [asset-delete](../api/asset-delete.md)
- [Assets RLS](../db/assets.md)
