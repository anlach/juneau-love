---
type: edge-function
title: asset-upload-url (presigned image upload)
description: "Edge function that issues one-off presigned S3 PUTs (15-min TTL) for an approved guest — one for the original, one for its client-generated WebP thumbnail — keys chosen server-side, content-type and size limits enforced up front."
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-28T06:07:06Z }
---

# asset-upload-url

The write side of the [guest gallery](../stories/guest-gallery.md).
Guests upload their own images; the bucket stays private, so the browser
gets presigned PUTs for exactly the two keys **the function chose**
(original and thumbnail).

## Contract

```
POST /functions/v1/asset-upload-url
Authorization: Bearer <approved guest access token>
Content-Type: application/json

{ "filename": "photo.jpg", "content_type": "image/jpeg",
  "byte_size": 204800, "thumb_byte_size": 131072 }
```

## Behavior

1. Verify the session (401 if invalid), then that the caller is
   approved — queried with the anon key + caller's token, so
   [assets RLS](../db/assets.md) remains the rule (403 otherwise).
2. Validate against the v1 limits from the [guest
   gallery](../stories/guest-gallery.md) story: `content_type` in the
   allowlist and `byte_size` under the cap; the thumbnail is always
   `image/webp` by design and its declared size is checked against the
   2 MB cap. 415 / 413 otherwise.
3. Generate both keys server-side: `uploads/<user_id>/<uuid>` and
   `thumbs/<user_id>/<uuid>.webp`. A malicious client can never
   target another user's keys or an admin-seeded key.
4. Sign presigned PUTs (15-minute TTL) for both keys: the original's
   with the declared `Content-Type` as a signed header, the
   thumbnail's with `image/webp` (on Hippius the gateway does not
   enforce them — see [Known gaps](#known-gaps-accepted-for-v1)).
5. Return `{ s3_key, thumb_s3_key, upload_url, thumb_upload_url,
   expires_at }`. The client then:
   1. Generates the thumbnail **before** calling this function (canvas
      downscale → WebP, long edge 800 px, quality 0.8, never
      upscaling — the business rule in the
      [guest gallery](../stories/guest-gallery.md) story), which is how
      it knows `thumb_byte_size`.
   2. `PUT`s both bytes to their URLs with the matching `Content-Type`
      header (CORS is handled by the S3 endpoint — Hippius gateway
      hosted, local storage-api in local dev; see [Supabase
      project](../platform/project.md#assets-s3-hippius-local-stack)).
   3. On a 200 from both PUTs, inserts the [assets](../db/assets.md)
      row via PostgREST (`user_id` = `auth.uid()`, `s3_key`/
      `thumb_s3_key`/`content_type`/`byte_size` as returned). The row
      appears in every approved guest's gallery on their next load.

## Responses

| Status | Body | When |
|---|---|---|
| 200 | `{ s3_key, thumb_s3_key, upload_url, thumb_upload_url, expires_at }` | approved caller, limits pass |
| 400 | `{ error: "bad_request" }` | malformed body, missing fields |
| 401 | `{ error: "unauthorized" }` | no valid session |
| 403 | `{ error: "not_approved" }` | session valid, user not approved |
| 413 | `{ error: "too_large" }` | `byte_size` above the size cap |
| 415 | `{ error: "unsupported_type" }` | `content_type` not in the allowlist |

## Known gaps (accepted for v1)

- The row is inserted only **after** both successful PUTs; a failed or
  abandoned upload leaves **orphan objects** (original and/or
  thumbnail) in the bucket with no row. Orphans are invisible to the
  site (nothing enumerates bucket keys); cleanup is an open question.
- No magic-byte validation of the uploaded bytes yet — the limits
  check the declared headers only (including `thumb_byte_size`, a
  client assertion). Revisit if abuse appears.
- The presigned PUT's signed `Content-Type` is **not enforced by the
  Hippius gateway**: a PUT with a different `Content-Type` also
  succeeds, and the type actually sent is what gets stored (verified
  2026-10-18). The client is expected to send the declared type; a
  mismatch degrades to a broken image, because
  [asset-url](asset-url.md) pins `response-content-type` from the row on
  every GET — not a wrong type served or a visibility hole. (Local dev:
  the storage S3 endpoint enforces the signed header by signature — a
  mismatch 403s.)
- A `filename` is accepted for possible logging/future display but
  plays no role in the key.
