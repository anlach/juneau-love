---
type: user-story
title: Sign in with a login link (passcode)
description: An approved guest gets a session by clicking a passcode link in an email — valid 7 days, unlimited uses, any device; a lost or expired session is recovered by entering the guest's email to get a fresh link.
status: draft
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-17T21:46:01Z }
---

# Sign in with a login link

**As an** approved guest,
**I want to** log in by clicking a link in an email (no password),
**so that** getting access is a single tap and a lost session can be
recovered without contacting anyone.

## Flow — first login (step 2 of 2)

1. Prerequisite: the guest already confirmed their email at registration
   (step 1 — see [Register as a guest](/register-as-guest.md)) and an
   admin approved them.
2. The approval email arrives with the login link (passcode in the URL).
3. Click → `https://juneau.love/login?code=...` → the page redeems the
   code via the `login-with-passcode` edge function → a Supabase session
   is installed (1-day access token + 1-year refresh token) → the guest
   lands on guest content. The code is stripped from the URL after
   redemption.

## Flow — recover / re-sign in (any later time)

1. The guest visits the site without a valid session (first visit on a
   new device, cleared browser, the 1-year refresh token lapsed, or they
   signed out).
2. The sign-in page asks for their email (the site's only sign-in form).
3. `send-login-link`: registered **and** approved → a fresh link is
   emailed (the previous passcode is invalidated). 10-minute cooldown
   between sends.
4. Click → the first-login flow, step 3.

## Acceptance criteria

- [ ] A valid, unexpired passcode establishes a session on any
      device/browser, even if the guest already holds a session from the
      email-confirmation step (the new session simply replaces it).
- [ ] The same link can be used again later (unlimited uses until
      expiry), on as many devices as the guest wants — each device gets
      its own independent session.
- [ ] A passcode older than 7 days (from issuance) is rejected with a
      "this link is no longer valid — request a new one" message and a
      path to the email form.
- [ ] A passcode for a user who was **rejected** after the link was sent
      is rejected instantly (status is re-checked at redemption).
- [ ] A re-sent link invalidates the previous one (at most one live
      passcode per user).
- [ ] The code never persists in the URL after redemption, and an
      expired/invalid link shows a friendly state, never a raw error.
- [ ] A not-registered or not-approved email receives no link; the
      response distinguishes `not_found` / `not_approved` so the FE can
      say "not registered yet" vs "approval pending".

## Business rules

- **No password, ever.** The passcode link is the only credential.
  "Sign in" = "email me a link". There is no password reset — the
  resend flow replaces it.
- **Initial login is two steps:** confirm the email at registration
  (step 1), then click the login link after approval (step 2). Recovery
  and re-signin are one step (the email form).
- **Passcode lifetime:** 7 days from issuance, unlimited uses, any
  number of devices.
- **Rotation:** each send generates a new passcode; only the most recent
  is valid, and it is dead the moment it is redeemed for a *rejected*
  user — status checks at redemption are the second layer.
- **Sessions:** 1-day access token, 1-year refresh token, auto-refreshed
  by supabase-js and persisted in localStorage (not cookies — static
  site). A returning visitor with a valid refresh token never needs a
  link.
- **Cooldown:** at most one link per 10 minutes per user (anti-spam;
  email quota is a real resource).
- **The passcode is a bearer credential:** it exists only inside the
  emailed link, is never returned to any browser, and only the service
  role can read it.

## Depends on

- [login_passcodes](../db/login_passcodes.md)
- [login-with-passcode](../api/login-with-passcode.md),
  [send-login-link](../api/send-login-link.md),
  [Client authentication](../api/client-auth.md)
- [Register as a guest](/register-as-guest.md) (step 1)
