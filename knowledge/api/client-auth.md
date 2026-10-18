---
type: auth-flow
title: Client authentication (passwordless, login links)
description: "No passwords. Registration is email + display name; initial login is two steps — confirm the email, then click the login link in an email after approval. The link is a native GoTrue magiclink exchanged client-side for a Supabase session (1-day access token, 1-year refresh token, auto-refreshed and persisted by supabase-js) with stock mechanics."
status: draft
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-18T16:31:19Z }
---

# Client authentication

**Passwordless, two gates.** Users have no passwords. Getting access
requires (1) confirming the registration email and (2) admin approval,
after which the guest clicks a login link in an email. The whole
user-facing auth surface is: register (email + display name), click a
confirmation link, click a login link, or enter an email to request a
fresh link. RLS remains the security boundary; the **service role** key
lives only in the edge functions (`send-login-link`,
`registration-decision`). There is **no login edge function** — the login
link is a native GoTrue magiclink exchanged client-side by stock
supabase-js (see the Design notes at the bottom).

## Client setup

```js
createClient(url, anonKey, {
  auth: {
    storage: localStorage,        // persisted session (not cookies — static site)
    persistSession: true,
    detectSessionInUrl: true,     // handles both URL codes: the signup confirmation
                                  // (type=signup) and the login link (type=magiclink)
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
- The login link is therefore the **re-authentication path**: first
  login, new device, cleared browser, or the refresh token lapsing after
  a year.
- Accepted trade-off: the 1-year refresh token is a bearer credential in
  localStorage (XSS-exposed). Fine at this site's scale; revisit if the
  threat model changes.

## Flow 1 — register + confirm email (client-side, anon key)

**Step 1 of initial login.**

- `supabase.auth.signUp({ email, options: { data: { display_name }, emailRedirectTo: 'https://juneau.love/auth/confirm' } })`
  — **no password**.
- Email confirmation is **enabled** (project setting) → GoTrue emails a
  "confirm your email" link (Supabase auth email template, sent via the
  project's email provider). **No session is created yet**; the FE shows
  a session-independent "check your email to confirm your address" screen.
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

## Flow 2 — log in via the login link

1. The link is a **native GoTrue magiclink**, generated server-side by
   [send-login-link](/send-login-link.md) or
   [registration-decision](/registration-decision.md) via GoTrue's admin
   `generate_link` API and emailed to the guest. **Step 2 of initial
   login** (step 1 was the email confirmation). The guest may already
   hold a session from step 1b — the exchange simply replaces it; on a
   new device there is no session yet.
2. Click → GoTrue's verify endpoint validates the token and redirects to
   `https://juneau.love/login?code=...&type=magiclink`.
   `detectSessionInUrl` exchanges the code for a session — **the same
   mechanism as the confirmation link**, no custom client code. The page
   strips the code from the URL (`history.replaceState`) so it never
   lingers in history/bookmarks.
3. From then on it's plain supabase-js session management (auto-refresh,
   persistence, `signOut`).
4. Expired / already-used / invalid link → a friendly "this link is no
   longer valid — request a new one" state with a path to the email form.
   GoTrue owns the token's lifetime; a fresh link is one tap away.

## Flow 3 — request a link (the only "sign in")

1. Sign-in page: a single email field.
2. POST `send-login-link` `{ email }`:
   - registered **and** approved → a fresh GoTrue magiclink is generated
     and emailed → "a link is on its way".
   - not registered → "that email isn't registered yet" (+ register CTA).
   - registered, not approved → "you're registered — approval is pending"
     (or the rejection message).
   - 10-minute cooldown → "we sent one recently — check your inbox" (with
     retry hint).
3. User clicks the link → Flow 2.

This one flow covers first login, new device, lost/cleared session, and
the 1-year refresh expiry. **There is no password reset — asking for a
link replaces it.**

## After auth

The layout fetches current-user state (own status + permissions) and
routes to the right screen ([Access by approval
status](../stories/access-by-approval-status.md)).

## Project setup requirements

- Auth: **email confirmation enabled** (the confirmation link is step 1
  of initial login).
- Auth: JWT expiry **1 day**, refresh token expiry **365 days**.
- Edge functions: `send-login-link` must be **publicly invokable** (called
  with no JWT); `registration-decision` requires an authenticated caller
  and re-verifies admin itself. There is **no login edge function** — the
  link is exchanged client-side.
- Transactional email provider — **TBD** (Resend suggested; free tier
  covers a wedding's volume). It serves both Supabase's auth emails
  (confirmation link, via the project's email/SMTP settings) and the edge
  functions' login-link emails.

## Design notes — why no custom passcode

The original design stored a per-user 7-day **passcode** in a
`login_passcodes` table, redeemed by a public `login-with-passcode` edge
function for a session. That required a service-role function to **issue
a GoTrue session on a user's behalf** — GoTrue has no such endpoint
(verified against the GoTrue v2.197.0 admin routes: no session/JWT
issuance), so every implementation path was a hack (temp password +
password grant, self-signed JWT, hand-inserted session rows).

Simplified (trade-off accepted by the human, 2026-10-18): the login link
is now a **native GoTrue magiclink** — GoTrue generates, stores, expires,
and validates the token, and the client exchanges it with stock
supabase-js. What is given up:

- **7-day validity → GoTrue-managed lifetime** (default ~1 hour; exact
  value and configurability to be confirmed on the local stack before
  implementation). A stale link costs one tap on the email form.
- **Unlimited uses / any number of devices → one exchange per link.** A
  second device requests a fresh link — which is exactly the recovery
  flow.
- **Status re-check at redemption.** A link emailed before a later
  rejection can still be exchanged — the rejected guest gets a session
  but RLS yields zero rows and the client shows the rejection screen.
  Accepted at this site's scale.

What this eliminates: the `login_passcodes` table (shipped in the initial
migration; deprecated and to be dropped by a follow-up migration — see
[login_passcodes](../db/login_passcodes.md)), the `login-with-passcode`
function (never written; concept removed), and the session-issuance
problem class entirely.
