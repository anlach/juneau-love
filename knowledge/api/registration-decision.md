---
type: edge-function
title: registration-decision (approve / reject + invite email)
description: Admin-only edge function that approves or rejects a registration; approving requires a verified email and issues a fresh login passcode plus the invite email, rejecting kills any unredeemed link.
status: draft
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-17T21:15:03Z }
---

# registration-decision

The write side of the admin registrations page
(`knowledge/stories/review-registrations.md`). Approval must also issue a
passcode and send an email, so this is an **edge function** (service
role) rather than a PostgREST update — the `users` table has no client
write path for `status` at all.

## Contract

```
POST /functions/v1/registration-decision
Authorization: Bearer <admin access token>
Content-Type: application/json

{ "target_user_id": "<uuid>", "decision": "approve" | "reject" }
```

## Behavior

Single DB transaction, then email:

1. Verify the caller has the `admin` role (service-role query of
   [user_roles](../db/user_roles.md) using the JWT's `sub`). 403
   otherwise.
2. Load the target [users](../db/users.md) row. 404 if unknown.
3. Validate the transition against the status-transition matrix. 409 if
   illegal (e.g. re-deciding an already-decided row).
4. **Verify-then-approve gate (approve only):** require
   `users.email_confirmed_at IS NOT NULL` — an admin may only approve a
   verified email (gate 1 must pass before gate 2). 409
   `{ error: "email_not_confirmed" }` otherwise. Reject is always allowed —
   the admin can clean up unverified rows.
5. `UPDATE users SET status = ...` — the sync trigger grants/revokes the
   `guest` role atomically in the same transaction.
6. **Approve:** upsert a fresh [login_passcodes](../db/login_passcodes.md)
   row (new 7-day passcode) and send the invite email with the link
   `https://juneau.love/login?code=<passcode>`.
   **Reject:** delete the user's `login_passcodes` row — an unredeemed
   link dies immediately.
7. Return the updated row + whether the email went out.

## Responses

| Status | Body | When |
|---|---|---|
| 200 | `{ user: { id, email, display_name, status, created_at }, email_sent: true \| false }` | decision applied |
| 403 | `{ error: "not_admin" }` | caller lacks the admin role |
| 404 | `{ error: "not_found" }` | unknown `target_user_id` |
| 409 | `{ error: "invalid_transition" }` | illegal status change |
| 409 | `{ error: "email_not_confirmed" }` | approving an email that was never confirmed |

Email failure **after** the DB commit still returns 200 with
`email_sent: false` (the decision stands; the guest — or a future
"resend" button — can trigger `send-login-link`). The FE re-fetches the
registrations list after every call.

## Enforcement layers

- **Function:** caller is admin; transition is legal; verify-then-approve
  gate; email/passcode side effects happen exactly once per decision.
- **DB:** the guard trigger re-enforces the transition matrix for
  `status` writers (service role allowed), and the sync trigger keeps
  roles consistent — so the DB is correct even if the function logic
  regresses.
