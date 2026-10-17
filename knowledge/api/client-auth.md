---
type: auth-flow
title: Client authentication (passwordless, passcode links)
description: "No passwords. Registration is email + display name; initial login is two steps — confirm the email, then click the passcode login link after approval. The link is redeemed by an edge function for a Supabase session (1-day access token, 1-year refresh token, auto-refreshed and persisted by supabase-js)."
status: draft
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-17T21:15:03Z }
---

# Client authentication

**Passwordless, two gates.** Users have no passwords. Getting access
requires (1) confirming the registration email and (2) admin approval, after
which the guest clicks a passcode link in an email. The whole user-facing
auth surface is: register (email + display name), click a confirmation
link, click a passcode link, or ask for a new link by entering an email.
RLS remains the security boundary; the **service role** key lives only in
the edge functions (`login-with-passcode`, `send-login-link`,
`registration-decision`).

## Client setup

```js
createClient(url, anonKey, {
  auth: {
    storage: localStorage,        // persisted session (not cookies — static site)
    persistSession: true,
    detectSessionInUrl: true,     // picks up the signup confirmation code (and future OAuth); the passcode is NOT a GoTrue URL code
  },
});
```

## Token lifetimes (Supabase project settings — setup requirement)

- **Access token: 1 day** (JWT expiry setting = 86400s).
- **Refresh token: 1 year** (refresh token expiry setting = 365 days, the
  GoTrue maximum).
- supabase-js auto-refreshes the access token from the refresh token; the
  session persists in localStorage, so a returning visitor with a valid
  refresh token never needs a link again.
- The passcode link is therefore the **re-authentication path**: first
  login, new device, cleared browser, or the refresh token lapsing after a
  year.
- Accepted trade-off: the 1-year refresh token is a bearer credential in
  localStorage (XSS-exposed). Fine at this site's scale; revisit if the
  threat model changes.

## Flow 1 — register + confirm email (client-side, anon key)

**Step 1 of initial login.**

- `supabase.auth.signUp({ email, options: { data: { display_name }, emailRedirectTo: 'https://juneau.love/auth/confirm' } })`
  — **no password**.
- Email confirmation is **enabled** (project setting) → GoTrue emails a
  "confirm your email" link (Supabase auth email template, sent via the
  project's email provider). **No session is created yet**; the FE shows a
  session-independent "check your email to confirm your address" screen.
- Backend side effect: the `auth.users` trigger creates the
  [users](../db/users.md) row in `pending`, unconfirmed.
- Errors:
  - email already registered → "already registered — sign in" (the sign-in
    page is the email form; a rejected account gets its rejection screen
    after signing in and cannot re-register).
  - invalid email / invalid display name → stay on the form with the
    message.

## Flow 1b — confirming the email

1. The guest clicks the confirmation link
   (`https://juneau.love/auth/confirm?code=...&type=signup` — a real
   GoTrue code). `detectSessionInUrl: true` handles it: the account is
   confirmed and **a session is established** in this browser.
2. The mirror trigger copies `email_confirmed_at` onto the `users` row,
   so the admin's registrations table shows a verified indicator and the
   `registration-decision` function will allow approving this user.
3. Layout: session + `status = 'pending'` → the **"awaiting approval"**
   screen (no site content yet) with a "check status" re-fetch.

## Flow 2 — log in via passcode link

1. The link is `https://juneau.love/login?code=<passcode>` — **step 2 of
   initial login** (step 1 was the email confirmation). The guest may
   already hold a session from step 1b — `setSession` simply replaces it;
   on a new device there is no session yet. The page reads the code,
   **strips it from the URL** (`history.replaceState`) so it never lingers
   in history/bookmarks, and POSTs it to `login-with-passcode`.
2. On success the function returns a Supabase session pair; the client
   calls `supabase.auth.setSession({ access_token, refresh_token })`.
   From then on it's plain supabase-js session management
   (auto-refresh, persistence, `signOut`).
3. Invalid/expired code → friendly "this link is no longer valid — request
   a new one" state with a path to the email form.

## Flow 3 — request a link (the only "sign in")

1. Sign-in page: a single email field.
2. POST `send-login-link` `{ email }`:
   - registered **and** approved → fresh (rotated) passcode + email sent →
     "a link is on its way".
   - not registered → "that email isn't registered yet" (+ register CTA).
   - registered, not approved → "you're registered — approval is pending"
     (or the rejection message).
   - 10-minute cooldown → "we sent one recently — check your inbox"
     (with retry hint).
3. User clicks the link → Flow 2.

This one flow covers first login, new device, lost/cleared session, and
the 1-year refresh expiry. **There is no password reset — asking for a
link replaces it.**

## After auth

The layout fetches current-user state (own status + permissions) and
routes to the right screen (`knowledge/stories/access-by-approval-status.md`).

## Project setup requirements

- Auth: **email confirmation enabled** (the confirmation link is step 1 of
  initial login).
- Auth: JWT expiry **1 day**, refresh token expiry **365 days**.
- Edge functions: `login-with-passcode` and `send-login-link` must be
  **publicly invokable** (called with no JWT); `registration-decision`
  requires an authenticated caller and re-verifies admin itself.
- Transactional email provider — **TBD** (Resend suggested; free tier
  covers a wedding's volume). It serves both Supabase's auth emails
  (confirmation link, via the project's email/SMTP settings) and the edge
  functions' passcode emails.
