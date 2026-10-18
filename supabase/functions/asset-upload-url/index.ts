// asset-upload-url — one-off presigned S3 PUT for an approved guest.
//
// Contract: knowledge/api/asset-upload-url.md. The key is chosen
// server-side (uploads/<user_id>/<uuid>) so a client can never target
// another user's key or an admin-seeded key. Limits are the v1 limits
// from the guest gallery story: content-type allowlist + 5 MB cap.

import { json, jwtSub, restAsUser } from "../_shared/index.ts";
import { S3, presignS3ObjectUrl, s3Configured } from "../_shared/s3.ts";

const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_ASSET_BYTES = 5 * 1024 * 1024; // 5 MB
const PRESIGN_TTL_SECONDS = 900; // 15 minutes

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
  const b = body as { filename?: unknown; content_type?: unknown; byte_size?: unknown };
  if (
    typeof b.content_type !== "string" ||
    typeof b.byte_size !== "number" || !Number.isFinite(b.byte_size) || b.byte_size <= 0 ||
    (b.filename !== undefined && typeof b.filename !== "string")
  ) {
    return json({ error: "bad_request" }, { status: 400 });
  }

  const authorization = req.headers.get("Authorization");
  const userJwt = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  const sub = jwtSub(authorization);
  if (!userJwt || sub === null) {
    return json({ error: "unauthorized" }, { status: 401 });
  }
  if (!s3Configured()) {
    return json({ error: "unavailable" }, { status: 500 });
  }

  // Approved check, read as the caller (users_read_own RLS): a missing or
  // non-approved row means not approved.
  const usersRes = await restAsUser(`users?select=status&id=eq.${sub}`, userJwt);
  if (usersRes === null || usersRes.status < 200 || usersRes.status >= 300) {
    console.error(`[asset-upload-url] users lookup failed (HTTP ${usersRes?.status})`);
    return json({ error: "unavailable" }, { status: 500 });
  }
  const users = (usersRes.data ?? []) as Array<{ status: string }>;
  if (!users.some((u) => u.status === "approved")) {
    return json({ error: "not_approved" }, { status: 403 });
  }

  if (!ALLOWED_CONTENT_TYPES.includes(b.content_type)) {
    return json({ error: "unsupported_type" }, { status: 415 });
  }
  if (b.byte_size > MAX_ASSET_BYTES) {
    return json({ error: "too_large" }, { status: 413 });
  }

  const s3Key = `uploads/${sub}/${crypto.randomUUID()}`;
  const { url, expiresAt } = await presignS3ObjectUrl({
    bucket: S3.bucket,
    key: s3Key,
    method: "PUT",
    expiresInSeconds: PRESIGN_TTL_SECONDS,
    signedHeaders: { "content-type": b.content_type },
  });
  return json({ s3_key: s3Key, upload_url: url, expires_at: expiresAt });
});
