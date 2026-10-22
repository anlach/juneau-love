// Minimal AWS Signature V4 signer for Hippius S3 (the private assets bucket).
//
// Hippius connection facts (docs.hippius.com/storage/s3):
//   endpoint   https://s3.hippius.com  (the only host; path-style addressing)
//   region     "decentralized"
//   signature  AWS SigV4, with two Hippius-specific requirements:
//     1. the scope terminator is "aws4_request", not the AWS-standard
//        "request" (matches both Hippius' own SigV4 test suite and the live
//        gateway — verified 2026-10-18);
//     2. requests must carry a content hash. Presigned (query-auth) URLs
//        carry X-Amz-Content-Sha256=UNSIGNED-PAYLOAD as a query parameter;
//        header-auth requests carry the x-amz-content-sha256 header
//        (sha256 of the body, or "UNSIGNED-PAYLOAD").
//   The bucket itself is private and no browser ever sees credentials; the
//   functions below only *sign URLs*. Hand-rolled on purpose: pulling the
//   full AWS SDK into free-tier edge functions is overkill for presigning.
//   Verified against the official AWS SigV4 test vectors (supabase/tests/
//   s3-presign.ts) and against the live service.
//
// Local dev: the local stack's storage-api serves the same S3 protocol
// (same SigV4 scheme, `aws4_request` terminator, `X-Amz-Content-Sha256`
// handling — verified 2026-10-20 against storage-api v1.82.1), but objects
// live under an origin-relative path prefix: /storage/v1/s3/<bucket>/<key>
// (Kong strips /storage/v1 before forwarding; storage-api re-prepends its
// S3_PROTOCOL_PREFIX to the canonical URI, so the prefix must be part of
// the *signed* path, not just the request URL). Set S3_PATH_PREFIX to
// "/storage/v1/s3" (with S3_ENDPOINT as the bare origin
// http://127.0.0.1:54321) to test against the local stack; leave it unset
// for Hippius. The S3_* values for the local stack are the CLI's built-in
// defaults — see supabase/config.toml [edge_runtime.secrets].

const encoder = new TextEncoder();

/**
 * Environment for the assets bucket.
 * Hosted: set via `supabase secrets set`. Local stack: see
 * [edge_runtime.secrets] in supabase/config.toml.
 */
export const S3 = {
  /** Origin (scheme://host[:port]) the object URLs are built against. */
  endpoint: (Deno.env.get("S3_ENDPOINT") ?? "https://s3.hippius.com").replace(/\/+$/, ""),
  /**
   * Origin-relative path between the origin and the bucket, e.g.
   * "/storage/v1/s3" for the local stack. Empty for Hippius. Both the
   * request URL and the signed canonical path include it.
   */
  pathPrefix: (Deno.env.get("S3_PATH_PREFIX") ?? "").replace(/\/+$/, ""),
  region: Deno.env.get("S3_REGION") ?? "decentralized",
  bucket: Deno.env.get("S3_BUCKET") ?? "",
  accessKeyId: Deno.env.get("S3_ACCESS_KEY_ID") ?? "",
  secretAccessKey: Deno.env.get("S3_SECRET_ACCESS_KEY") ?? "",
};

/** True when the edge function's S3 env is complete enough to presign. */
export function s3Configured(): boolean {
  return Boolean(S3.endpoint && S3.region && S3.bucket && S3.accessKeyId && S3.secretAccessKey);
}

type Bytes = ArrayBuffer | Uint8Array<ArrayBuffer>;

function bufToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(key: Bytes, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
}

export async function sha256Hex(data: string | Bytes): Promise<string> {
  const buf = typeof data === "string" ? encoder.encode(data) : data;
  return bufToHex(await crypto.subtle.digest("SHA-256", buf));
}

/** RFC 3986 percent-encoding (SigV4's stricter variant of encodeURIComponent). */
export function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Canonical query string: RFC 3986-encode key and value, sort by key (then value). */
export function canonicalQuery(params: Record<string, string>): string {
  const entries = Object.entries(params).map(([k, v]) => [rfc3986(k), rfc3986(v)] as const);
  entries.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
  return entries.map(([k, v]) => `${k}=${v}`).join("&");
}

/** Current time in the format AWS dates use: YYYYMMDDTHHMMSSZ. */
export function amzTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** HMAC signing-key chain: AWS4-secret -> date -> region -> service -> terminator. */
async function signingKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
  terminator: string,
): Promise<ArrayBuffer> {
  let key = await hmacSha256(encoder.encode(`AWS4${secretAccessKey}`), dateStamp);
  key = await hmacSha256(key, region);
  key = await hmacSha256(key, service);
  key = await hmacSha256(key, terminator);
  return key;
}

export interface SignInput {
  method: string;
  /** Canonical path, e.g. /juneau-assets/uploads/<uuid>. */
  path: string;
  host: string;
  /** All query parameters, WITHOUT X-Amz-Signature. */
  params: Record<string, string>;
  /**
   * Headers to sign, lowercase names. Values are trimmed and their
   * internal whitespace runs collapsed to a single space (per SigV4).
   * Must include "host".
   */
  signedHeaders: Record<string, string>;
  /** Hex sha256 of the payload, or "UNSIGNED-PAYLOAD". */
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  /** "request" (AWS) or "aws4_request" (Hippius). */
  terminator: string;
  /** Inject the clock for deterministic tests. */
  timestamp?: string;
}

export interface Signature {
  signature: string;
  /** Included for debugging/matching against known answers. */
  canonicalRequest: string;
  stringToSign: string;
  scope: string;
}

/**
 * Build the canonical request + string-to-sign and compute the SigV4
 * signature. Shared by both auth styles below. Exported for the
 * test-vector self-test (supabase/tests/s3-presign.ts).
 */
export async function sign(input: SignInput): Promise<Signature> {
  const timestamp = input.timestamp ?? amzTimestamp();
  const dateStamp = timestamp.slice(0, 8);
  const scope = `${dateStamp}/${input.region}/${input.service}/${input.terminator}`;
  const headerNames = Object.keys(input.signedHeaders).map((n) => n.toLowerCase()).sort();
  const canonicalHeaders = headerNames
    .map((n) => `${n}:${String(input.signedHeaders[n]).trim().replace(/\s+/g, " ")}\n`)
    .join("");
  const signedHeadersLine = headerNames.join(";");
  const canonicalRequest = [
    input.method,
    input.path,
    canonicalQuery(input.params),
    canonicalHeaders,
    signedHeadersLine,
    input.payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    timestamp,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const key = await signingKey(input.secretAccessKey, dateStamp, input.region, input.service, input.terminator);
  const signature = bufToHex(await hmacSha256(key, stringToSign));
  return { signature, canonicalRequest, stringToSign, scope };
}

export interface PresignInput {
  bucket: string;
  /** Object key, e.g. uploads/<user_id>/<uuid>. Must not contain spaces or non-ASCII. */
  key: string;
  method: "GET" | "PUT";
  expiresInSeconds: number;
  /**
   * Extra headers the caller must send verbatim when using the URL
   * (e.g. { "content-type": "image/jpeg" } for a PUT). Lowercase names.
   */
  signedHeaders?: Record<string, string>;
  /** Extra query parameters to sign (e.g. { "response-content-type": "image/jpeg" }). */
  extraQuery?: Record<string, string>;
  /** Inject the clock for deterministic tests. */
  timestamp?: string;
}

/**
 * Presign a private-bucket object URL (query-string auth, no credentials
 * in the URL). The resulting URL is valid for `expiresInSeconds` (Hippius
 * caps presign expiry at 7 days) and can be fetched straight from the
 * browser — the Hippius gateway answers CORS preflights itself.
 */
export async function presignS3ObjectUrl(input: PresignInput): Promise<{ url: string; expiresAt: string }> {
  if (!s3Configured()) throw new Error("S3 env not configured (S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY)");
  const host = new URL(S3.endpoint).host;
  const path = `${S3.pathPrefix}/${S3.bucket}/${input.key.split("/").map(rfc3986).join("/")}`;
  const timestamp = input.timestamp ?? amzTimestamp();
  const dateStamp = timestamp.slice(0, 8);
  const scope = `${dateStamp}/${S3.region}/s3/aws4_request`;
  const signedHeaders: Record<string, string> = { host, ...(input.signedHeaders ?? {}) };
  const params: Record<string, string> = {
    ...input.extraQuery,
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${S3.accessKeyId}/${scope}`,
    "X-Amz-Content-Sha256": "UNSIGNED-PAYLOAD",
    "X-Amz-Date": timestamp,
    "X-Amz-Expires": String(input.expiresInSeconds),
    // Per the AWS presigning spec, the signed-header list is itself part of
    // the canonical query string.
    "X-Amz-SignedHeaders": Object.keys(signedHeaders).map((n) => n.toLowerCase()).sort().join(";"),
  };
  const { signature } = await sign({
    method: input.method,
    path,
    host,
    params,
    signedHeaders,
    payloadHash: "UNSIGNED-PAYLOAD",
    accessKeyId: S3.accessKeyId,
    secretAccessKey: S3.secretAccessKey,
    region: S3.region,
    service: "s3",
    terminator: "aws4_request",
    timestamp,
  });
  const url = `${S3.endpoint}${path}?${canonicalQuery(params)}&X-Amz-Signature=${signature}`;
  // Expiry relative to the signed timestamp (identical in production, where
  // the timestamp is now; deterministic when a timestamp is injected).
  const signedAtMs = Date.parse(
    `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T${timestamp.slice(9, 11)}:${timestamp.slice(11, 13)}:${timestamp.slice(13, 15)}.000Z`,
  );
  return { url, expiresAt: new Date(signedAtMs + input.expiresInSeconds * 1000).toISOString() };
}

/**
 * Headers for a direct (header-auth) request to the bucket — used by admin
 * tooling and tests (e.g. DeleteObject to clean up), never by the edge
 * functions themselves.
 *
 * `path` is the full signed path: origin-relative, including S3.pathPrefix
 * if configured (e.g. `/storage/v1/s3/juneau-assets/<key>` locally,
 * `/juneau-assets/<key>` on Hippius).
 */
export async function signedRequestHeaders(
  method: string,
  path: string,
  bodyHash: string,
  extraHeaders: Record<string, string> = {},
): Promise<Record<string, string>> {
  if (!s3Configured()) throw new Error("S3 env not configured");
  const host = new URL(S3.endpoint).host;
  const timestamp = amzTimestamp();
  const signedHeaders: Record<string, string> = {
    host,
    "x-amz-content-sha256": bodyHash,
    "x-amz-date": timestamp,
    ...Object.fromEntries(Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v])),
  };
  const { signature, scope } = await sign({
    method,
    path,
    host,
    params: {},
    signedHeaders,
    payloadHash: bodyHash,
    accessKeyId: S3.accessKeyId,
    secretAccessKey: S3.secretAccessKey,
    region: S3.region,
    service: "s3",
    terminator: "aws4_request",
    timestamp,
  });
  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(extraHeaders).map(([k, v]) => [k, v])),
    "x-amz-content-sha256": bodyHash,
    "x-amz-date": timestamp,
    authorization: `AWS4-HMAC-SHA256 Credential=${S3.accessKeyId}/${scope}, SignedHeaders=${Object.keys(signedHeaders).sort().join(";")}, Signature=${signature}`,
  };
  return headers;
}
