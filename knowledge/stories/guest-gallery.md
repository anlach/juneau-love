---
type: user-story
title: Guest gallery
description: "Approved guests share a gallery of images stored in a private S3 bucket — admin-seeded and guest-uploaded — with bytes reaching the browser only via short-lived presigned URLs. The grid loads client-generated WebP thumbnails; the full-size original loads on demand. Uploaders and admins can delete photos."
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-28T06:07:06Z }
---

# Guest gallery

**As an** approved guest,
**I want to** see a gallery of images — including ones other guests
have uploaded — and add my own,
**so that** the people on this site can share photos without exposing
them to the public internet.

## Flow

1. An approved guest opens the gallery page. The FE reads
   [assets](../db/assets.md) (RLS returns every row to any approved
   guest), ordered newest first, then fetches the uploaders' display
   names from the `guest_names` view in one batched query and joins
   them client-side (a direct [users](../db/users.md) join is blocked
   by its self-only RLS; see [assets](../db/assets.md)).
2. The FE passes the asset ids to [asset-url](../api/asset-url.md) in
   one batched call and renders the returned presigned **thumbnail**
   URLs (15-minute TTL) as `<img>` sources, caching them until near
   expiry. The same call returns the full-size original URL, which is
   fetched only on demand (when a guest opens an image — a new tab in
   v1; see [Gallery thumbnail rendering](../design/gallery-thumbnails.md)).
   Rows without a thumbnail fall back to the full-size URL.
3. To upload: choose an image → the browser downscales it to a WebP
   thumbnail locally → [asset-upload-url](../api/asset-upload-url.md)
   returns presigned PUTs for **both** the original and the thumbnail →
   the browser PUTs both → the client inserts the assets row (both
   keys). The new image (as its thumbnail) appears in every approved
   guest's gallery on their next load.

## Acceptance criteria

- [ ] Signed-out visitors, `pending` users, and `rejected` users see
      zero images and obtain zero URLs; the public landing page has no
      gallery at all.
- [ ] An approved guest sees every image (admin-seeded and
      guest-uploaded), newest first, with the uploader's name.
- [ ] Guest upload works end to end (presigned PUTs for original and
      thumbnail + row insert) within the type/size limits, and the new
      row is visible to other guests.
- [ ] The grid loads the thumbnail, not the full-size object, for every
      image that has one; full-size bytes are fetched only when a guest
      opens an image.
- [ ] No S3 key, bucket name, or credential appears in the repo, the
      client bundle, or any prerendered HTML.
- [ ] A URL issued for one user's visible rows can never be obtained
      for rows they may not see (rows are RLS-filtered before signing).

## Business rules

- **Images live in the private external S3 bucket**, not the GitHub
  repo and not Supabase Storage — the rationale (free-tier storage cap)
  is in [assets](../db/assets.md). Supabase holds only the metadata.
- **Visibility = approval.** "Visible to an authorized guest" means
  `users.status = 'approved'` — the same rule that gates all guest
  content ([Access by approval status](/access-by-approval-status.md)).
- **Upload limits (v1):** `image/jpeg`, `image/png`, `image/webp`;
  5 MB max; object key chosen server-side
  (`uploads/<user_id>/<uuid>`).
- **Delete is scoped, not free:** uploaders delete their own photos,
  admins any photo ([Delete photos](delete-photos.md)) — the boundary
  is the RLS DELETE policy on [assets](../db/assets.md), and the
  [asset-delete](../api/asset-delete.md) function also removes the S3
  objects behind the rows. No client UPDATE.
- **A rejected uploader's photos remain:** status changes never
  delete assets rows (only deleting the user row cascades), so
  photos uploaded before a rejection stay in the gallery — intended
  for v1.
- **Thumbnails are generated client-side at upload time** (browser
  downscale → WebP, long edge 800 px, never upscaling, quality 0.8):
  the grid's network weight stays small with no server-side image
  processing. Why on-the-fly transforms (Supabase Storage
  transforms, Hippius) were ruled out is in
  [assets](../db/assets.md). Admin-seeded photos get their thumbnails
  by a one-off admin backfill (same out-of-band convention as
  seeding).
- **Orphan objects** from failed uploads (original and/or
  thumbnail) are invisible and tolerated in v1 (see
  [asset-upload-url](../api/asset-upload-url.md)).

## Depends on

- [assets](../db/assets.md), [users](../db/users.md)
- [asset-url](../api/asset-url.md), [asset-upload-url](../api/asset-upload-url.md), [asset-delete](../api/asset-delete.md)
- [Delete photos](delete-photos.md)
- [Access by approval status](/access-by-approval-status.md)
