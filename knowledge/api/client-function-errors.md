---
type: api-convention
title: Decoding edge-function errors in the client
description: "How the browser reads status codes and structured error codes ({ error: <code> }) from a failed supabase.functions.invoke — and why error.context is a trap."
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-19T05:30:00Z }
verified: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-19T05:30:00Z }
---

# Decoding edge-function errors in the client

The client calls edge functions through `supabase.functions.invoke`. When a
call fails non-2xx, the specific error UX (cooldown message,
environment message, transition message) depends on reading the failure
correctly. This concept fixes that shape once; the per-function concepts
only name their codes.

## The failure shape (supabase-js 2.x, functions-js 2.x)

`invoke` always resolves to `{ data, error, response }` — it does not
throw:

| Case | `data` | `error` | `response` |
|---|---|---|---|
| 2xx | parsed body | `null` | the `Response` |
| non-2xx | `null` | `FunctionsHttpError` | **the raw `Response`** |
| network failure | `null` | `FunctionsFetchError` | `undefined` |

The trap: `FunctionsHttpError.context` is that same **raw `Response`
object** — not the parsed body, and the error has **no `status`
property**. Reading `error.status` or `error.context.error` is silently
`undefined` (this was a real bug — the 429/400 branches of the login
page were dead code until e2e caught it).

## The convention

- Status code → `response?.status`.
- Structured error code → `functionErrorCode(response)` from
  [`src/lib/fn-error.ts`](../../src/lib/fn-error.ts). It reads the body
  once (the client never consumed it on the error path) and returns the
  `error` field of our `{ "error": "<code>" }` convention, or `null` when
  the body is non-JSON (e.g. the edge runtime's "Function not found"
  text) — callers then fall back to a generic "try again" message.

## Where it is applied

| Route | Codes it branches on |
|---|---|
| [`/login`](../../src/routes/login/+page.svelte) | `429` → "sent one recently"; `400` → invalid email |
| [`/gallery`](../../src/routes/gallery/+page.svelte) upload | `unavailable` (S3 not configured) |
| [`/registrations`](../../src/routes/registrations/+page.svelte) decide | `email_not_confirmed`, `invalid_transition` |

The codes themselves are specified per function:
[send-login-link](/send-login-link.md),
[asset-upload-url](/asset-upload-url.md),
[registration-decision](/registration-decision.md).

## Depends on

- [send-login-link](/send-login-link.md),
  [asset-url](/asset-url.md), [asset-upload-url](/asset-upload-url.md),
  [registration-decision](/registration-decision.md)
