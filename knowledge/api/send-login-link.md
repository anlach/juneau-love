---
type: edge-function
title: send-login-link (sign in / resend link)
description: Publicly invokable edge function that emails a fresh GoTrue magiclink login link to a given email, but only if the user is registered and approved; 10-minute cooldown per user.
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-20T05:29:10Z }
verified: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-18T20:33:20Z }
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
   stores the token and owns its lifetime. The redirect origin must match
   GoTrue's configured `site_url` or GoTrue silently rewrites it (local
   `SITE_URL` function env — [project
   notes](../platform/project.md), Local development).
   Request/response shape verified locally (GoTrue v2.197.0): the
   response is the full user object plus
   - `action_link` — the verify-endpoint URL to email:
     `/auth/v1/verify?token=...&type=magiclink&redirect_to=...`,
   - `email_otp` — GoTrue also mints a 6-digit code for the same link
     (the design ignores it and sends the link),
   - `hashed_token`, `verification_type: "magiclink"`.
3. Send the email via **Resend** (function secrets `RESEND_API_KEY` and
   `EMAIL_FROM` — see [project
   notes](../platform/project.md)): friendly message + `action_link`.
   Without `RESEND_API_KEY` (local dev) the link is printed to the
   function log instead and the call counts as sent.
4. `UPDATE users SET last_login_link_sent_at = now()`.
5. 200 `{ sent: true }`.

## Responses

| Status | Body | When |
|---|---|---|
| 200 | `{ sent: true }` | link sent (or dev-logged locally) |
| 200 | `{ sent: false, reason: "not_found" \| "not_approved" }` | no link sent |
| 400 | `{ error: "bad_request" }` | malformed body or invalid email |
| 429 | `{ retry_after_seconds }` | resend cooldown active |
| 502 | `{ error: "link_failed" \| "email_failed" }` | GoTrue or Resend failed (cooldown not stamped — a retry is safe) |

## Invariants

- Only **approved** users receive links; the 10-minute cooldown is
  anti-spam (email quota is a real resource). Both rules live in the
  [Sign in with a login link](../stories/sign-in-with-login-link.md)
  story.
- The function never touches sessions and returns no session or link
  material; the token lives entirely in GoTrue ([Client
  authentication](/client-auth.md), Trade-offs), and the cooldown
  timestamp is the only state it keeps.
