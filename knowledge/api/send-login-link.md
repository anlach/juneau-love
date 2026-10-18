---
type: edge-function
title: send-login-link (sign in / resend link)
description: Publicly invokable edge function that emails a fresh GoTrue magiclink login link to a given email, but only if the user is registered and approved; 10-minute cooldown per user.
status: draft
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-18T16:31:19Z }
---

# send-login-link

The site's **"sign in"** action and its recovery path: enter an email,
get (or get resent) the login link (see [Sign in with a login
link](../stories/sign-in-with-login-link.md)). The link is a **native
GoTrue magiclink**: this function checks eligibility, asks GoTrue for a
link, and emails it. It never touches sessions.

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
     they can't log in yet. The `not_found` / `not_approved` distinction
     is deliberate and accepted: it lets the FE say "not registered yet"
     vs "approval pending" (see [Sign in with a login
     link](../stories/sign-in-with-login-link.md)); email enumeration is
     not a threat at this site's scale.
   - approved → cooldown check: if `users.last_login_link_sent_at` is
     within the last 10 minutes → 429 `{ retry_after_seconds }`.
2. **Generate the link:** call GoTrue admin `POST /auth/v1/admin/generate_link`
   (service role) with `{ email, type: "magiclink",
   redirect_to: "https://juneau.love/login" }` → `action_link`. GoTrue
   stores the token and owns its lifetime (confirm the exact
   request/response shape on the local stack before implementing).
3. Send the email: friendly message + `action_link` (email provider —
   **TBD**, Resend suggested; in local dev the message is logged and the
   link is read from the function log).
4. `UPDATE users SET last_login_link_sent_at = now()`.
5. 200 `{ sent: true }`.

## Responses

| Status | Body | When |
|---|---|---|
| 200 | `{ sent: true }` | link sent |
| 200 | `{ sent: false, reason: "not_found" \| "not_approved" }` | no link sent |
| 429 | `{ retry_after_seconds }` | resend cooldown active |

## Business rules

- Only **approved** users receive links.
- The link token lives entirely in GoTrue — this function and our schema
  store **no credential**; the cooldown timestamp is the only state we
  keep.
- Each send generates a fresh link; earlier links are short-lived,
  single-use tokens, so old emails go stale quickly (GoTrue's
  lifetime/supersession semantics confirmed in the local spike).
- 10-minute cooldown per user (anti-spam; email provider quota is a real
  resource).
- No session or link material is returned in any HTTP response.
