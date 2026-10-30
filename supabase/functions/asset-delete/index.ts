// asset-delete — delete asset rows the caller's RLS allows, plus the S3
// objects behind them.
//
// Contract: knowledge/api/asset-delete.md. The DELETE policy
// (knowledge/db/assets.md) is the security boundary: the row deletion runs
// AS the caller (anon key + caller token), so rows the policy refuses —
// another user's photo, unapproved caller — are silently skipped, and a
// hand-crafted Data API delete is scoped to the same predicate. The S3
// objects are then removed best-effort with the function's S3 credentials:
// row first, bytes after, so a refused delete leaves the photo fully
// intact and a failed object delete degrades to an invisible orphan
// (tolerated in v1, knowledge/stories/guest-gallery.md) — never to a
// broken gallery row.

import { json, jwtSub, restAsUser, withCors } from "../_shared/index.ts";
import { deleteS3Object, s3Configured } from "../_shared/s3.ts";

const MAX_IDS_PER_CALL = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, { status: 405, headers: { allow: "POST" } });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, { status: 400 });
  }
  const asset_ids = (body as { asset_ids?: unknown })?.asset_ids;
  if (
    !Array.isArray(asset_ids) || asset_ids.length === 0 || asset_ids.length > MAX_IDS_PER_CALL ||
    !asset_ids.every((v) => typeof v === "string" && UUID.test(v))
  ) {
    return json({ error: "bad_request" }, { status: 400 });
  }

  const authorization = req.headers.get("Authorization");
  const userJwt = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  if (!userJwt || jwtSub(authorization) === null) {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  // The row delete runs as the caller: the assets_delete_own_or_admin
  // policy decides what actually goes. `return=representation` answers
  // with exactly the rows the policy let go — their object keys are what
  // the cleanup below needs. Rows the policy refuses and unknown ids are
  // simply absent from the body; nothing about them is reported.
  const idList = [...new Set(asset_ids as string[])].join(",");
  const del = await restAsUser(
    `assets?select=id,s3_key,thumb_s3_key&id=in.(${idList})`,
    userJwt,
    { method: "DELETE", prefer: "return=representation" },
  );
  if (del === null || del.status < 200 || del.status >= 300) {
    console.error(`[asset-delete] row delete failed (HTTP ${del?.status})`);
    return json({ error: "unavailable" }, { status: 500 });
  }
  const deleted = (del.data ?? []) as Array<{
    id: string;
    s3_key: string;
    thumb_s3_key: string | null;
  }>;

  // S3 cleanup, best-effort per object: the row is already gone, so a
  // failed delete only orphans bytes. S3 DeleteObject is a no-op (204/404)
  // on a missing key; anything else is logged and moved past.
  const keys = deleted.flatMap((row) =>
    [row.s3_key, row.thumb_s3_key].filter((k): k is string => Boolean(k))
  );
  if (s3Configured()) {
    await Promise.all(
      keys.map(async (key) => {
        const status = await deleteS3Object(key);
        if (status !== 204 && status !== 404) {
          console.error(`[asset-delete] S3 object delete failed (HTTP ${status}): ${key}`);
        }
      }),
    );
  } else {
    console.error("[asset-delete] S3 not configured — rows deleted, object cleanup skipped");
  }

  return json({ deleted: deleted.map((r) => r.id) });
}));
