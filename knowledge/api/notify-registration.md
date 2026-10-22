---
type: edge-function
title: notify-registration (admin alert for new registrations)
description: Publicly invokable edge function that emails every admin a new-registration alert with approve/reject deep links; idempotent via users.admin_notified_at, so each registration alerts at most once.
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-20T15:50:00Z }
---

# notify-registration

The admin side of a **new registration**: every admin receives an email
with the guest's details (name, email, registered time, verification
state) and two deep links — **Approve** / **Reject** — into the
[registrations page](../stories/review-registrations.md)
(`?approve=<user_id>` / `?reject=<user_id>`). The page turns each link
into a confirm banner; the actual decision goes through
[registration-decision](/registration-decision.md) with the admin's own
session. The links therefore **carry no privilege** — an admin who is not
signed in lands on the sign-in screen, and nobody but an admin can decide
anything ([RBAC](../db/rbac.md)).

## Contract

```
POST /functions/v1/notify-registration        (publicly invokable — no JWT)
Content-Type: application/json

{ "email": "guest@example.com" }
```

## Callers (both client-side)

1. **At signup** — the register page fires it right after the magic-link
   signup call succeeds (the guest is still anonymous; no session yet).
2. **Fallback** — the root layout fires it whenever a signed-in user's
   own row is `pending` and `admin_notified_at` is still null (the
   awaiting-approval screen). Covers the signup-time call that never went
   through (tab closed). A failed send is not stamped, so a later
   "check status" retry fires again.

## Behavior

1. Look up [users](../db/users.md) by `email` (service role).
   - not found → 200 `{ sent: false, reason: "not_found" }`
   - `status != 'pending'` → 200 `{ sent: false, reason: "not_pending" }`
     (re-approving a rejected guest is a re-decision, not a new
     registration — no re-alert)
   - `admin_notified_at` set → 200 `{ sent: false, reason: "already_notified" }`
     (the idempotency stamp — repeat calls are no-ops)
2. **Recipients:** every user holding the `admin` role (users →
   user_roles → roles). None → 200 `{ sent: false, reason: "no_admins" }`
   — **not stamped**: once an admin exists (bootstrap), a later call
   alerts for real.
3. Send one email to all recipients (through the mail relay — [Mail
   (self-hosted Maddy)](../platform/mail.md)) with the guest details, the
   current verification state, and the two deep links plus a plain link to
   the full registrations page. Without a relay (local dev) the
   email is printed to the function log and the call counts as sent (same
   dev mode as [send-login-link](/send-login-link.md)).
4. `UPDATE users SET admin_notified_at = now()` — stamped **after** a
   successful send (best effort, like the send-login-link cooldown stamp).
5. 200 `{ sent: true }`.

## Responses

| Status | Body | When |
|---|---|---|
| 200 | `{ sent: true }` | alert sent (or dev-logged locally) and stamped |
| 200 | `{ sent: false, reason: "not_found" \| "not_pending" \| "already_notified" \| "no_admins" }` | no alert sent |
| 400 | `{ error: "bad_request" }` | malformed body or invalid email |
| 502 | `{ error: "email_failed" }` | Mail relay failed — **not stamped**, so the next call retries |

## Invariants

- **At most one alert per registration** (the
  [users](../db/users.md) `admin_notified_at` stamp; at-least-once — a
  rare duplicate beats a lost alert).
- **Alerts only for `pending` registrations** — nothing is re-alerted on
  re-approval or any other state change.
- **The function never applies a decision.** Approve/reject remain the
  admin-gated [registration-decision](/registration-decision.md) call
  (permissions, transition matrix, verify-then-approve gate, and the
  guest's login-link email all unchanged).
- **Public without a JWT by design** (like
  [send-login-link](/send-login-link.md)): the caller is anonymous at
  signup time, and an anonymous caller can only trigger the one deduped
  alert about a registration the admins already see in their list — the
  alert reveals no more than the registrations table shows an admin.
- **A pending registration that is never confirmed is never alerted** by
  the fallback (the guest only holds a session after confirming); the
  signup-time call is the only path for it. Accepted — such rows still
  appear in the admin's registrations list.

## Depends on

- [users](../db/users.md) (the `admin_notified_at` stamp, guard trigger)
- [RBAC](../db/rbac.md) (who counts as an admin)
- [Review registrations](../stories/review-registrations.md) (the deep
  links' destination)
