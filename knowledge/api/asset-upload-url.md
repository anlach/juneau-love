---
type: edge-function
title: asset-upload-url (presigned image upload)
description: "Edge function that issues a one-off presigned S3 PUT (15-min TTL) for an approved guest — key chosen server-side, content-type and size limits enforced up front."
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-18T16:59:45Z }
verified: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-18T23:15:00Z }
---

# asset-upload-url

The write side of the [guest gallery](../stories/guest-gallery.md).
Guests upload their own images; the bucket stays private, so the browser
gets a presigned PUT for exactly one key **the function chose**.

## Contract

```
POST /functions/v1/asset-upload-url
Authorization: Bearer <approved guest access token>
Content-Type: application/json

{ "filename": "photo.jpg", "content_type": "image/jpeg", "byte_size": 204800 }
```

## Behavior

1. Verify the session (401 if invalid), then that the caller is
   approved — queried with the anon key + caller's token, so
   [assets RLS](../db/assets.md) remains the rule (403 otherwise).
2. Validate against the v1 limits from the [guest
   gallery](../stories/guest-gallery.md) story: `content_type` in the
   allowlist and `byte_size` under the cap. 415 / 413 otherwise.
3. Generate the key server-side: `uploads/<user_id>/<uuid>`. A
   malicious client can never target another user's key or an
   admin-seeded key.
4. Sign a presigned PUT (15-minute TTL) with the declared
   `Content-Type` as a signed header (the Hippius gateway does not
   enforce it — see [Known gaps](#known-gaps-accepted-for-v1)).
5. Return `{ s3_key, upload_url, expires_at }`. The client then:
   1. `PUT`s the bytes to `upload_url` with the matching
      `Content-Type` header (CORS is handled by the Hippius gateway —
      see [Supabase project](../platform/project.md#assets-s3-hippius)).
   2. On a 200 from the PUT, inserts the [assets](../db/assets.md) row
      via PostgREST (`user_id` = `auth.uid()`, `s3_key`/`content_type`/
      `byte_size` as returned). The row appears in every approved
      guest's gallery on their next load.

## Responses

| Status | Body | When |
|---|---|---|
| 200 | `{ s3_key, upload_url, expires_at }` | approved caller, limits pass |
| 400 | `{ error: "bad_request" }` | malformed body, missing fields |
| 401 | `{ error: "unauthorized" }` | no valid session |
| 403 | `{ error: "not_approved" }` | session valid, user not approved |
| 413 | `{ error: "too_large" }` | `byte_size` above the size cap |
| 415 | `{ error: "unsupported_type" }` | `content_type` not in the allowlist |

## Known gaps (accepted for v1)

- The row is inserted only **after** a successful PUT; a failed or
  abandoned PUT leaves an **orphan object** in the bucket with no row.
  Orphans are invisible to the site (nothing enumerates bucket keys);
  cleanup is an open question.
- No magic-byte validation of the uploaded bytes yet — the limits check
  the declared headers only. Revisit if abuse appears.
- The presigned PUT's signed `Content-Type` is **not enforced** by the
  Hippius gateway: a PUT with a different `Content-Type` also succeeds,
  and the type actually sent is what gets stored (verified 2026-10-18).
  The client is expected to send the declared type; a mismatch degrades
  to a broken image, because [asset-url](asset-url.md) pins
  `response-content-type` from the row on every GET — not a wrong type
  served or a visibility hole.
- A `filename` is accepted for possible logging/future display but
  plays no role in the key.
