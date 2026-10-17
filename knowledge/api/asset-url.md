---
type: edge-function
title: asset-url (presigned image GET URLs)
description: "Edge function that exchanges asset ids for short-lived (15-min) presigned S3 GET URLs — but only for rows the caller's RLS allows. The only way browser code ever sees an image byte."
status: draft
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-17T21:48:25Z }
---

# asset-url

The read path for guest-restricted images
([guest gallery](../stories/guest-gallery.md)). The S3 bucket is
**private**: the browser never sees S3 credentials and cannot enumerate
keys, so this function is the single place that signs URLs — and it
signs **only** for rows the caller's RLS can read.

Why an edge function: S3 credentials cannot live in a static site's
browser, and `adapter-static` means there is no server at runtime to
sign on. The function is kept light for the free tier: batched, stateless,
no transforms (thumbnails are out of scope, see
[assets](../db/assets.md)).

## Contract

```
POST /functions/v1/asset-url
Authorization: Bearer <user access token>
Content-Type: application/json

{ "asset_ids": ["<uuid>", ...] }   // 1..100 per call
```

## Behavior

1. Verify the session against the bearer token. 401 if missing/invalid.
2. Query [assets](../db/assets.md) using a client built from the **anon
   key plus the caller's Authorization header**, so RLS — not function
   logic — decides visibility:
   `select id, s3_key, content_type where id in (...)`. Rows the caller
   may not see simply do not come back.
3. For each returned row, sign a presigned GET: 15-minute TTL,
   `response-content-type` pinned to the row's `content_type`.
4. Return one entry per id that came back. Unknown or not-visible ids
   are **omitted**, never listed as errors — the existence of images a
   caller may not see is never disclosed.

## Responses

| Status | Body | When |
|---|---|---|
| 200 | `{ urls: [ { asset_id, url, expires_at } ] }` | always for a valid session (possibly empty) |
| 400 | `{ error: "bad_request" }` | empty list or more than 100 ids |
| 401 | `{ error: "unauthorized" }` | no valid session |

## Frontend expectations

- Call **once per gallery load**, batched — not per image; cache the
  returned URLs client-side until shortly before `expires_at`.
- Never bake a presigned URL into prerendered HTML (`adapter-static`
  rule): the gallery renders client-side after the session check
  ([Access by approval status](../stories/access-by-approval-status.md)).
- A presigned URL is a bearer credential: treat it as a short-lived
  ticket, never persist it beyond the page session.

## Enforcement layers

- **Function:** session valid; signs only for rows returned by the
  RLS-filtered query. It has **no** service-role read path to assets at
  all — the anon-key-plus-user-token query *is* the visibility check.
- **DB:** [assets RLS](../db/assets.md) is the actual visibility rule.
- **S3:** bucket policy blocks all public access; keys are unguessable;
  URL TTL is 15 minutes.
