---
type: user-story
title: Sign in with a login link
description: An approved guest gets a session by clicking a login link in an email — a native GoTrue magiclink, short-lived and single-use; a lost or expired session is recovered by entering the guest's email to get a fresh link.
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-18T16:59:45Z }
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
2. The approval email arrives with the login link — a native
   **GoTrue magiclink** (see [Client
   authentication](../api/client-auth.md)).
3. Click → GoTrue's verify endpoint redirects to
   `https://juneau.love/login` **with the session tokens in the URL
   fragment**; stock supabase-js (`detectSessionInUrl`) installs the
   session (1-day access token + 1-year refresh token) and the page strips
   the fragment. The guest lands on guest content. (Mechanism detail in
   [Client authentication](../api/client-auth.md), Flow 2 — there is no
   `code` to exchange.)

## Flow — recover / re-sign in (any later time)

1. The guest visits the site without a valid session (first visit on a
   new device, cleared browser, the 1-year refresh token lapsed, or they
   signed out).
2. The sign-in page asks for their email (the site's only sign-in form).
3. `send-login-link`: registered **and** approved → a fresh link is
   emailed. 10-minute cooldown between sends.
4. Click → the first-login flow, step 3.

## Acceptance criteria

- [ ] A valid, unexpired link establishes a session in the clicking
      browser, even if the guest already holds a session from the
      email-confirmation step (the new session simply replaces it).
- [ ] A link is **single-use**: signing in on a second device means
      requesting a fresh link (the recovery flow) — one exchange per
      link.
- [ ] An expired or already-used link is rejected with a "this link is no
      longer valid — request a new one" message and a path to the email
      form. The link's lifetime is GoTrue's (default ~1h; confirm at
      implementation), not ours to configure.
- [ ] A link for a user who was **rejected** after it was sent may still
      be exchanged (GoTrue does not know our status) — the guest lands on
      the **rejection screen** with zero data access (RLS). Accepted
      trade-off; rejected users can never *request* a link.
- [ ] A not-registered or not-approved email receives no link; the
      response distinguishes `not_found` / `not_approved` so the FE can
      say "not registered yet" vs "approval pending".
- [ ] The session tokens never persist in the URL after the exchange, and an
      expired/invalid link shows a friendly state, never a raw error.

## Business rules

- **No password, ever.** The emailed link is the only credential.
  "Sign in" = "email me a link". There is no password reset — the resend
  flow replaces it.
- **Initial login is two steps:** confirm the email at registration
  (step 1), then click the login link after approval (step 2). Recovery
  and re-signin are one step (the email form).
- **The link is GoTrue-owned:** the token is generated, stored, and
  validated entirely by GoTrue (magiclink via the admin `generate_link`
  API). Our schema stores **no credential** — the only state we keep is
  the cooldown timestamp
  ([users](../db/users.md) `last_login_link_sent_at`).
- **Accepted trade-offs:** GoTrue-managed link lifetime, one exchange
  per link, and no status re-check at redemption (RLS + the rejection
  screen are the backstop) — see [Client
  authentication](../api/client-auth.md), Trade-offs.
- **Sessions:** 1-day access token, 1-year refresh token, auto-refreshed
  by supabase-js and persisted in localStorage ([Client
  authentication](../api/client-auth.md)). A returning visitor with a
  valid refresh token never needs a link.
- **Cooldown:** at most one link per 10 minutes per user (anti-spam;
  email quota is a real resource).

## Depends on

- [users](../db/users.md) (cooldown timestamp)
- [send-login-link](../api/send-login-link.md),
  [Client authentication](../api/client-auth.md)
- [Register as a guest](/register-as-guest.md) (step 1)
- [Access by approval status](/access-by-approval-status.md)
