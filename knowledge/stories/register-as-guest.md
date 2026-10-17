---
type: user-story
title: Register as a guest
description: A guest registers with email and display name (no password); the registration starts in pending state, the guest confirms their email, and then it waits for an admin decision.
status: draft
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-17T21:15:03Z }
---

# Register as a guest

**As a** guest of the wedding,
**I want to** register my email and display name (no password),
**so that** I can confirm my address, be approved, and get access to the
site.

## Flow

1. Guest opens the site (public landing is visible without an account)
   and chooses "register".
2. Form collects **email and display name** (there is no password); the
   FE validates (non-empty, email shape) before calling the API.
3. `signUp` succeeds → the DB trigger creates the registration row in
   `pending` → GoTrue emails a **confirm-your-email** link (**step 1 of 2
   for initial login**). No session yet; the FE shows a
   "check your email to confirm your address" screen.
4. Guest clicks the confirmation link → the account is confirmed and a
   session is established in this browser → the guest lands on the
   **"awaiting approval"** screen (no site content yet).
5. An admin later approves (see
   `knowledge/stories/review-registrations.md`) → the guest receives an
   email with their **login link** (**step 2 of 2**, see
   `knowledge/stories/sign-in-with-login-link.md`) → guest content.

## Acceptance criteria

- [ ] A new registration always lands in `pending` and unconfirmed — no
      path (UI or hand-crafted request) can create a row in any other
      state or claim a verification timestamp.
- [ ] Email confirmation is on: **no session exists before the guest
      clicks the confirmation link**; after clicking it, the guest is
      signed in and sees the awaiting-approval screen with their display
      name.
- [ ] Registration works with no password anywhere in the flow.
- [ ] Re-registering with an existing email fails with a friendly
      "account already exists — sign in" message; the guest signs in
      instead (a rejected account leads to the rejection screen).
- [ ] The guest role is **not** held and **no login passcode exists**
      before approval (verified in the DB).

## Business rules

- **One registration per email** — enforced twice: Supabase Auth rejects
  duplicate signups, and `users.email` is unique.
- **Two gates before access:** (1) email verification — automated, via
  Supabase's confirmation email, proving the guest controls the address;
  (2) admin approval — the human vouching. Both must pass; the
  `registration-decision` function hard-refuses to approve an
  unverified email, and no login link is ever sent before approval.
- **Registration data is minimal:** email + display name, no password —
  passwordless by design, not a v1 limitation.
- **A rejected user cannot re-register** (their auth account exists);
  only an admin can re-approve them. Rejection also deletes any
  unredeemed login passcode.
- The confirmation email uses Supabase's auth email template; the
  post-approval email is our own invite (edge function, email provider
  TBD).

## Depends on

- `knowledge/db/users.md` (row-creation trigger, confirmation mirror,
  guard trigger, RLS)
- `knowledge/api/client-auth.md` (signup + confirmation contract)
- `knowledge/stories/sign-in-with-login-link.md` (what step 2 looks like)
- `knowledge/stories/access-by-approval-status.md` (what the pending
  screen is)
