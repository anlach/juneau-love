---
type: edge-function
title: send-login-link (sign in / resend link)
description: Publicly invokable edge function that emails a fresh passcode login link to a given email address, but only if the user is registered and approved; 10-minute cooldown per user.
status: draft
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-17T21:05:27Z }
---

# send-login-link

The site's **"sign in"** action and its recovery path: enter an email,
get (or get resent) the passcode link
(`knowledge/stories/sign-in-with-login-link.md`).

## Contract

```
POST /functions/v1/send-login-link            (publicly invokable — no JWT)
Content-Type: application/json

{ "email": "guest@example.com" }
```

## Behavior

1. Look up [users](../db/users.md) by `email` (service role).
   - not found → 200 `{ sent: false, reason: "not_found" }`
   - found but `status != 'approved'` → 200 `{ sent: false,
     reason: "not_approved" }` (the FE shows "you're registered — approval
     is pending" or the rejection message). Pending users get **no** link:
     they can't log in yet, and this endpoint must not leak which pending
     emails exist any faster than the `not_found` case — both are
     answered from the same function.
   - approved → cooldown check: if the user's
     [login_passcodes](../db/login_passcodes.md) `sent_at` is within the
     last 10 minutes → 429 `{ retry_after_seconds }`.
2. **Rotate:** upsert a fresh `passcode` (32 random bytes, base64url) with
   `expires_at = now() + 7d`, `sent_at = now()`. The previous passcode is
   dead at this moment.
3. Send the email: friendly message + the link
   `https://juneau.love/login?code=<passcode>` (email provider — **TBD**,
   Resend suggested).
4. 200 `{ sent: true }`.

## Responses

| Status | Body | When |
|---|---|---|
| 200 | `{ sent: true }` | link sent |
| 200 | `{ sent: false, reason: "not_found" \| "not_approved" }` | no link sent |
| 429 | `{ retry_after_seconds }` | resend cooldown active |

## Business rules

- Only **approved** users receive links.
- Each send rotates the passcode — at most one live passcode per user;
  old emails' links stop working.
- 10-minute cooldown per user (anti-spam; email provider quota is a real
  resource).
- The passcode itself is never returned in any HTTP response — it exists
  only in the emailed link.
