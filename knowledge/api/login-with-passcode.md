---
type: edge-function
title: login-with-passcode (redeem a login link)
description: Public edge function that exchanges a valid, unexpired passcode for a Supabase session (1-day access token + 1-year refresh token). Unlimited uses, any device; redemption does not consume the passcode.
status: draft
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-17T21:05:27Z }
---

# login-with-passcode

The system's only credential check — there are no passwords. A passcode
link from an email is redeemed here for a real Supabase session.

## Contract

```
POST /functions/v1/login-with-passcode        (publicly invokable — no JWT)
Content-Type: application/json

{ "code": "<passcode>" }
```

## Behavior

1. Look up [login_passcodes](../db/login_passcodes.md) by `passcode`
   (unique) → the user.
2. Valid **only if**: the row exists, `expires_at > now()`, and
   `users.status = 'approved'`. Checking status at redemption time means
   a user who was rejected after the link was sent is cut off instantly,
   even though the passcode row may still exist transiently.
3. Issue a Supabase session for that user via GoTrue's service-role
   user-JWT issuance ("Generate a user JWT" in Supabase's
   session-management docs; confirm the exact request/response shape at
   implementation time).
   **Fallback** if that endpoint is not available: sign the access JWT
   directly with the project's JWT secret (HS256; claims `sub`,
   `role: 'authenticated'`, `exp: +1d` — Supabase documents self-signing
   with the project secret) and run a stateless signed refresh JWT
   (`exp: +1y`) through a `refresh-session` function. That fallback means
   the client needs a small custom refresh wrapper instead of
   supabase-js auto-refresh — prefer the GoTrue path.
4. **No consumption, no rotation:** redemption leaves the row untouched —
   unlimited uses, any number of devices/browsers, each getting its own
   independent session.

## Responses

| Status | Body | When |
|---|---|---|
| 200 | `{ access_token, refresh_token, expires_in }` → client calls `supabase.auth.setSession(...)` | valid code |
| 400 | `{ error: "invalid_or_expired" }` | unknown code, expired, or user no longer approved |

The error is deliberately generic: it must not reveal whether an email is
registered.

## Notes

- Public endpoint → rate-limit at the edge (v1: per-IP throttle; check
  what Deno Deploy gives us at implementation time).
- The code is a 7-day bearer credential: the login page strips it from the
  URL after redemption, and links are HTTPS-only.
