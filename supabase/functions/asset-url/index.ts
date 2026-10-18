// asset-url — exchange asset ids for short-lived presigned S3 GET URLs.
//
// Contract: knowledge/api/asset-url.md. The S3 bucket is private; this
// function is the only place that signs read URLs, and it signs only for
// rows the caller's RLS returns (anon key + caller token query — no
// service-role read path). Unknown or not-visible ids are omitted, never
// reported: the existence of images a caller may not see is not disclosed.

import { json, jwtSub, restAsUser } from "../_shared/index.ts";
import { S3, presignS3ObjectUrl, s3Configured } from "../_shared/s3.ts";

const MAX_IDS_PER_CALL = 100;
const PRESIGN_TTL_SECONDS = 900; // 15 minutes
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
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
  if (!s3Configured()) {
    return json({ error: "unavailable" }, { status: 500 });
  }

  // RLS-filtered lookup as the caller: ids they may not see simply do not
  // come back. Dedupe so the response has at most one entry per id.
  const idList = [...new Set(asset_ids as string[])].join(",");
  const lookup = await restAsUser(
    `assets?select=id,s3_key,content_type&id=in.(${idList})`,
    userJwt,
  );
  if (lookup === null || lookup.status < 200 || lookup.status >= 300) {
    console.error(`[asset-url] assets lookup failed (HTTP ${lookup?.status})`);
    return json({ error: "unavailable" }, { status: 500 });
  }
  const rows = (lookup.data ?? []) as Array<{ id: string; s3_key: string; content_type: string }>;

  const urls = await Promise.all(
    rows.map(async (row) => {
      const { url, expiresAt } = await presignS3ObjectUrl({
        bucket: S3.bucket,
        key: row.s3_key,
        method: "GET",
        expiresInSeconds: PRESIGN_TTL_SECONDS,
        extraQuery: { "response-content-type": row.content_type },
      });
      return { asset_id: row.id, url, expires_at: expiresAt };
    }),
  );
  return json({ urls });
});
