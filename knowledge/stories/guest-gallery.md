---
type: user-story
title: Guest gallery
description: "Approved guests share a gallery of images stored in a private S3 bucket — admin-seeded and guest-uploaded — with bytes reaching the browser only via short-lived presigned URLs. No thumbnails, no delete in v1."
status: draft
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-17T21:48:25Z }
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
   guest), ordered newest first, with each uploader's display name
   joined from [users](../db/users.md).
2. The FE passes the asset ids to [asset-url](../api/asset-url.md) in
   one batched call and renders the returned presigned URLs
   (15-minute TTL) as `<img>` sources, caching them until near expiry.
3. To upload: choose an image → [asset-upload-url](../api/asset-upload-url.md)
   returns a presigned PUT → the browser PUTs the bytes → the client
   inserts the assets row. The new image appears in every approved
   guest's gallery on their next load.

## Acceptance criteria

- [ ] Signed-out visitors, `pending` users, and `rejected` users see
      zero images and obtain zero URLs; the public landing page has no
      gallery at all.
- [ ] An approved guest sees every image (admin-seeded and
      guest-uploaded), newest first, with the uploader's name.
- [ ] Guest upload works end to end (presigned PUT + row insert) within
      the type/size limits, and the new row is visible to other guests.
- [ ] No S3 key, bucket name, or credential appears in the repo, the
      client bundle, or any prerendered HTML.
- [ ] A URL issued for one user's visible rows can never be obtained
      for rows they may not see (rows are RLS-filtered before signing).

## Business rules

- **Images live in the private external S3 bucket**, not the GitHub
  repo and not Supabase Storage: the Supabase instance is on the free
  tier (file storage is capped at 1 GB), so bytes go to storage we
  already have. Supabase holds only [assets](../db/assets.md) metadata.
- **Visibility = approval.** "Visible to an authorized guest" means
  `users.status = 'approved'` — the same rule that gates all guest
  content ([Access by approval status](/access-by-approval-status.md)).
- **Upload limits (v1):** `image/jpeg`, `image/png`, `image/webp`;
  5 MB max; object key chosen server-side
  (`uploads/<user_id>/<uuid>`).
- **No delete in v1:** no client UPDATE/DELETE on assets; removal is
  out-of-band (S3 object, then row).
- **No thumbnails in v1:** full-size objects are served as-is; resizing
  and derived assets are deferred (open question).
- **Orphan objects** from failed uploads are invisible and tolerated
  in v1 (see [asset-upload-url](../api/asset-upload-url.md)).

## Depends on

- [assets](../db/assets.md), [users](../db/users.md)
- [asset-url](../api/asset-url.md), [asset-upload-url](../api/asset-upload-url.md)
- [Access by approval status](/access-by-approval-status.md)
