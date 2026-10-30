---
type: edge-function
title: asset-delete (batch photo deletion)
description: "JWT-protected edge function that batch-deletes asset rows the caller's RLS allows and best-effort removes the S3 objects behind them; the response lists only the ids actually deleted."
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-30T05:55:00Z }
---

# asset-delete

`POST /functions/v1/asset-delete` — deletes photos in a batch: the
`public.assets` row **and** the S3 objects behind it. The caller's own
JWT authorizes the call; the [assets RLS DELETE
policy](../db/assets.md) is the authorization boundary, not function
code.

## Contract

- **Body:** `{ asset_ids: string[] }` — 1–100 UUIDs; anything else is
  400 `bad_request`.
- **Auth:** the caller's JWT (edge-runtime-verified; the function
  re-checks `sub`) — 401 `unauthorized` without one.
- **Response:** 200 `{ deleted: string[] }` — only the ids the RLS
  actually let go. Unknown or refused ids are silently omitted, so
  "not in `deleted`" means "still there — safe to retry".
- 500 `unavailable` when the Data API call itself fails; 405 for
  non-POST.

## Mechanics

1. **Row delete runs as the caller**: PostgREST with the anon key plus
   the caller's `Authorization`, `Prefer: return=representation` — the
   body is exactly the rows the `assets_delete_own_or_admin` policy
   released, with their `s3_key`/`thumb_s3_key`. A hand-crafted Data
   API DELETE hits the same predicate, so there is no second path.
2. **S3 cleanup is best-effort per object** (original + thumbnail):
   SigV4 header-auth DeleteObject with the function's own bucket
   credentials, row first, bytes after. A refused delete leaves the
   photo fully intact; a failed object delete degrades to an invisible
   orphan (the bucket is private — objects are only reachable via
   signed URLs), tolerated in v1, logged, and never a broken gallery
   row.
3. **Dev reachability:** in the local stack the function reaches the
   S3 protocol through Kong (the container can't use the
   browser-facing `127.0.0.1` origin), with a dev-only signing-host
   subtlety — see the topology notes in
   `supabase/functions/_shared/s3.ts`.

## Depends on

- [Assets RLS (incl. the DELETE policy)](../db/assets.md)
- [asset-url (presigned image GET URLs)](asset-url.md) — same
  `_shared/s3.ts` signer
- [CORS preflights for browser calls to edge functions](edge-function-cors.md)
