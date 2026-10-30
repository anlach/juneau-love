---
type: api-convention
title: CORS preflights for browser calls to edge functions
description: "Why every browser-called edge function must answer OPTIONS itself (withCors in _shared) — the hosted runtime forwards preflights, and without it the browser blocks the JSON POST before the function body ever runs."
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-23T04:28:00Z }
verified: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-23T04:28:00Z }
---

# CORS preflights for browser calls to edge functions

Every edge function the site's browser code calls is wrapped in
`withCors` from
[`supabase/functions/_shared/index.ts`](../../supabase/functions/_shared/index.ts).
This is load-bearing, not decoration: the hosted edge runtime does not
answer CORS preflights itself — it **forwards `OPTIONS` to the
function**. If the function replies with anything but a 2xx carrying the
right allow-headers, the browser aborts the real `POST` and the function
body never runs.

## What broke (2026-10-22, observed on the hosted project)

- `supabase.functions.invoke` from the site failed on every call; sign-in
  was dead.
- Project logs showed the `OPTIONS` preflight answered **405** (the
  functions' own "non-POST" branch) and the `POST` never arriving.
- curl-based flow tests against the same functions **passed** — curl
  performs no preflight. The functions were fine; the browser door was
  locked.

## The convention

`withCors(handler)` in `_shared`:

- `OPTIONS` → `204` with `access-control-allow-origin` (the caller's
  `Origin`, or `*` when absent),
  `access-control-allow-headers: authorization, x-client-info, apikey,
  content-type`, `access-control-allow-methods: POST, OPTIONS`,
  `access-control-max-age: 86400`.
- every other response → stamped with `access-control-allow-origin` and
  `vary: origin`.

CORS is **not** the security boundary. The functions keep enforcing their
own auth (service role inside, JWT where required); the origin echo only
decides which browser may read the response.

## Verifying

A curl POST is not a valid test for this — it cannot fail the way the
browser does. Test the preflight itself:

```sh
curl -i -X OPTIONS https://<project-ref>.supabase.co/functions/v1/<fn> \
  -H "origin: https://juneau.love" \
  -H "access-control-request-method: POST" \
  -H "access-control-request-headers: content-type"
```

Expect `204` plus the `access-control-allow-*` headers. Then verify once
from a real browser.

## Applies to

All six functions — send-login-link, notify-registration,
registration-decision, asset-url, asset-upload-url, asset-delete
(commit `0e7c47b`; asset-delete added with the delete feature).
Any new browser-called function must be wrapped the same way.

## Depends on

- [Decoding edge-function errors in the client](/client-function-errors.md)
