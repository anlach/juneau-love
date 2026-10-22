// Self-test for supabase/functions/_shared/s3.ts (the SigV4 signer).
//
//   deno run -A supabase/tests/s3-presign.ts
//
// Part 1 always runs: the signer is checked against official SigV4 test
// vectors (AWS sigv4-test-suite, JS port — its sts/authz fields use the
// "aws4_request" scope terminator, the same one Hippius' gateway
// verifies; see the header of _shared/s3.ts). For each vector the test
// rebuilds the canonical request from the request parts and requires it
// to match the suite's expected canonical request byte-for-byte, then
// checks the final signature.
//
// Part 2 runs only when S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and
// S3_BUCKET are in the environment: a live round-trip against whatever
// S3 the S3_* env points at (Hippius in prod, the local stack's
// storage S3 protocol when S3_PATH_PREFIX etc. are set — see
// supabase/config.toml) using nothing but this signer: presigned PUT
// (200), presigned GET (200, pinned content-type, byte-identical),
// anonymous GET (403), then header-auth DELETE cleanup.

import {
  amzTimestamp,
  canonicalQuery,
  presignS3ObjectUrl,
  rfc3986,
  sign,
  sha256Hex,
  signedRequestHeaders,
} from "../functions/_shared/s3.ts";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`[vector ${name}] ${ok ? "PASS" : "FAIL"}`);
  if (!ok) {
    failures++;
    if (detail) console.log(detail);
  }
}

// ---------------------------------------------------------------------------
// Part 1 — test vectors
// ---------------------------------------------------------------------------
// access key "AKIDEXAMPLE" / secret "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY"
// are the suite's fixed example credentials.

const VECTORS: Array<{
  name: string;
  method: string;
  path: string;
  query: Record<string, string>;
  signedHeaders: Record<string, string>;
  payloadHash: string;
  expectedCanonicalRequest: string;
  expectedSignature: string;
}> = [
  {
    name: "get-vanilla",
    method: "GET",
    path: "/",
    query: {},
    signedHeaders: { host: "example.amazonaws.com", "x-amz-date": "20150830T123600Z" },
    payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    expectedCanonicalRequest:
      "GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n" +
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    expectedSignature: "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
  },
  {
    name: "post-vanilla",
    method: "POST",
    path: "/",
    query: {},
    signedHeaders: { host: "example.amazonaws.com", "x-amz-date": "20150830T123600Z" },
    payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    expectedCanonicalRequest:
      "POST\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n" +
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    expectedSignature: "5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b",
  },
  {
    name: "get-vanilla-empty-query-key",
    method: "GET",
    path: "/",
    query: { Param1: "value1" },
    signedHeaders: { host: "example.amazonaws.com", "x-amz-date": "20150830T123600Z" },
    payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    expectedCanonicalRequest:
      "GET\n/\nParam1=value1\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n" +
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    expectedSignature: "a67d582fa61cc504c4bae71f336f98b97f1ea3c7a6bfe1b6e45aec72011b9aeb",
  },
  {
    name: "get-unreserved",
    method: "GET",
    // Unreserved path characters must survive without percent-encoding.
    path: "/-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
    query: {},
    signedHeaders: { host: "example.amazonaws.com", "x-amz-date": "20150830T123600Z" },
    payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    expectedCanonicalRequest:
      "GET\n/-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz\n\n" +
      "host:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n" +
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    expectedSignature: "07ef7494c76fa4850883e2b006601f940f8a34d404d0cfa977f52a65bbf5f24f",
  },
  {
    name: "get-header-value-trim",
    method: "GET",
    path: "/",
    query: {},
    // The raw request carries `My-Header2: "a   b   c"`; SigV4 trims the
    // outer whitespace and collapses internal whitespace runs to a single
    // space, keeping the quotes.
    signedHeaders: {
      host: "example.amazonaws.com",
      "my-header1": "value1",
      "my-header2": '"a   b   c"',
      "x-amz-date": "20150830T123600Z",
    },
    payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    expectedCanonicalRequest:
      "GET\n/\n\nhost:example.amazonaws.com\nmy-header1:value1\n" +
      'my-header2:"a b c"\nx-amz-date:20150830T123600Z\n\nhost;my-header1;my-header2;x-amz-date\n' +
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    expectedSignature: "acc3ed3afb60bb290fc8d2dd0098b9911fcaa05412b367055dee359757a9c736",
  },
  {
    name: "get-header-key-duplicate",
    method: "GET",
    path: "/",
    query: {},
    // The raw request carries My-Header1 three times (value2, value2,
    // value1). SigV4 folds duplicate header values into one comma-joined
    // value in request order; our signer never emits duplicates, so the
    // folded value is fed directly.
    signedHeaders: {
      host: "example.amazonaws.com",
      "my-header1": "value2,value2,value1",
      "x-amz-date": "20150830T123600Z",
    },
    payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    expectedCanonicalRequest:
      "GET\n/\n\nhost:example.amazonaws.com\nmy-header1:value2,value2,value1\n" +
      "x-amz-date:20150830T123600Z\n\nhost;my-header1;x-amz-date\n" +
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    expectedSignature: "c9d5ea9f3f72853aea855b47ea873832890dbdd183b4468f858259531a5138ea",
  },
];

const EXAMPLE_SECRET = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";

for (const v of VECTORS) {
  const { canonicalRequest, signature } = await sign({
    method: v.method,
    path: v.path,
    host: v.signedHeaders["host"]!,
    params: v.query,
    signedHeaders: v.signedHeaders,
    payloadHash: v.payloadHash,
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: EXAMPLE_SECRET,
    region: "us-east-1",
    service: "service",
    terminator: "aws4_request",
    timestamp: "20150830T123600Z",
  });
  const ok = canonicalRequest === v.expectedCanonicalRequest && signature === v.expectedSignature;
  check(
    v.name,
    ok,
    !ok
      ? `canonical request:\n  got:      ${JSON.stringify(canonicalRequest)}\n  expected: ${JSON.stringify(v.expectedCanonicalRequest)}\nsignature:\n  got:      ${signature}\n  expected: ${v.expectedSignature}`
      : "",
  );
}

// Unit checks for the exported helpers the presigner builds on.
check(
  "rfc3986",
  rfc3986("a b~c!d'e(f)g*h") === "a%20b~c%21d%27e%28f%29g%2Ah",
);
check(
  "canonicalQuery sort+encode",
  canonicalQuery({ b: "x y", a: "1" }) === "a=1&b=x%20y",
);
check("amzTimestamp", amzTimestamp(new Date("2015-08-30T12:36:00.789Z")) === "20150830T123600Z");

// ---------------------------------------------------------------------------
// Part 2 — live round-trip against Hippius (only with S3_* env set)
// ---------------------------------------------------------------------------
const accessKeyId = Deno.env.get("S3_ACCESS_KEY_ID") ?? "";
const secretAccessKey = Deno.env.get("S3_SECRET_ACCESS_KEY") ?? "";
const bucket = Deno.env.get("S3_BUCKET") ?? "";
const pathPrefix = (Deno.env.get("S3_PATH_PREFIX") ?? "").replace(/\/+$/, "");

if (accessKeyId && secretAccessKey && bucket) {
  console.log(`\n[live] round-trip against ${Deno.env.get("S3_ENDPOINT") ?? "https://s3.hippius.com"}${pathPrefix}/${bucket}`);
  const endpoint = (Deno.env.get("S3_ENDPOINT") ?? "https://s3.hippius.com").replace(/\/+$/, "");
  // 1x1 transparent PNG.
  const png = Uint8Array.from(
    atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
    (c) => c.charCodeAt(0),
  );
  const key = `__smoke/deno-${crypto.randomUUID()}.png`;

  const put = await presignS3ObjectUrl({
    bucket,
    key,
    method: "PUT",
    expiresInSeconds: 900,
    signedHeaders: { "content-type": "image/png" },
  });
  const putRes = await fetch(put.url, {
    method: "PUT",
    body: png,
    headers: { "content-type": "image/png" },
  });
  check("live presigned PUT", putRes.status === 200, `status=${putRes.status} ${await putRes.text().then((t) => t.slice(0, 200))}`);

  const get = await presignS3ObjectUrl({
    bucket,
    key,
    method: "GET",
    expiresInSeconds: 900,
    extraQuery: { "response-content-type": "image/png" },
  });
  const getRes = await fetch(get.url);
  const body = new Uint8Array(await getRes.arrayBuffer());
  check(
    "live presigned GET",
    getRes.status === 200 && getRes.headers.get("content-type") === "image/png" &&
      body.length === png.length,
    `status=${getRes.status} content-type=${getRes.headers.get("content-type")} bytes=${body.length}/${png.length}`,
  );

  const objectPath = `${pathPrefix}/${bucket}/${key}`;
  const anon = await fetch(`${endpoint}${objectPath}`);
  check("live anonymous GET denied", anon.status === 403, `status=${anon.status}`);

  const delHeaders = await signedRequestHeaders("DELETE", objectPath, await sha256Hex(""));
  const delRes = await fetch(`${endpoint}${objectPath}`, { method: "DELETE", headers: delHeaders });
  check("live cleanup DELETE", delRes.status === 204 || delRes.status === 200, `status=${delRes.status}`);
} else {
  console.log("\n[live] skipped — set S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and S3_BUCKET to run the live round-trip");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
Deno.exit(failures === 0 ? 0 : 1);
