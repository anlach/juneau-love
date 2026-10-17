---
type: user-story
title: Register as a guest
description: A guest registers with email, display name, and password; the registration starts in pending state and waits for an admin decision.
status: draft
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-17T20:35:00Z }
---

# Register as a guest

**As a** guest of the wedding,
**I want to** register my email and display name with a password,
**so that** I can be approved and get access to the site.

## Flow

1. Guest opens the site (public landing is visible without an account)
   and chooses "register".
2. Form collects **email, display name, password**; the FE validates
   (non-empty, email shape, ≥6 chars) before calling the API.
3. `signUp` succeeds → the DB trigger creates the registration row in
   `pending` → with a live session, the guest lands on the
   **"awaiting approval"** screen (no site content yet).
4. An admin later approves (see `knowledge/stories/review-registrations.md`);
   the guest sees guest content on their next sign-in/refresh.

## Acceptance criteria

- [ ] A new registration always lands in `pending` — no path (UI or
      hand-crafted request) can create a row in any other state.
- [ ] The guest is signed in immediately after registering (email
      confirmation is disabled in the Supabase project).
- [ ] A pending guest sees only the awaiting-approval screen, with their
      display name shown.
- [ ] Re-registering with an existing email fails with a friendly
      "account already exists — sign in" message; the guest signs in
      instead (a rejected account leads to the rejection screen).
- [ ] The guest role is **not** held before approval (verified in the DB:
      no `user_roles` row until the admin approves).

## Business rules

- **One registration per email** — enforced twice: Supabase Auth rejects
  duplicate signups, and `users.email` is unique.
- **Review is the trust gate, not email ownership.** Email confirmation
  is intentionally off in v1; the admin's approval is what makes a guest
  real. (Open question: require confirmation later if registrations are
  abused.)
- **Registration data is minimal:** email + display name only in v1.
- **A rejected user cannot re-register** (their auth account exists);
  only an admin can re-approve them.
- No email confirmation on success, and no notification to the guest on
  approve/reject (open question — needs an edge function later).

## Depends on

- `knowledge/db/users.md` (row creation trigger, guard trigger, RLS)
- `knowledge/api/client-auth.md` (signup contract)
- `knowledge/stories/access-by-approval-status.md` (what the pending
  screen is)
