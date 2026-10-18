---
type: auth-flow
title: Client authentication (passwordless, login links)
description: No passwords. Registration is email + display name; initial login is two steps — confirm the email, then click the login link in an email after approval. The link is a native GoTrue magiclink exchanged client-side for a Supabase session with stock supabase-js.
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-18T18:45:00Z }
verified: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-18T18:44:57Z }
---

# Client authentication

**Passwordless, two gates.** Users have no passwords. Getting access
requires (1) confirming the registration email and (2) admin approval,
after which the guest clicks a login link in an email. The whole
user-facing auth surface is: register (email + display name), click a
confirmation link, click a login link, or enter an email to request a
fresh link.

RLS is the security boundary; the **service role** key lives only in the
edge functions ([send-login-link](/send-login-link.md),
[registration-decision](/registration-decision.md)). **There is no login
edge function** — the login link is a native GoTrue magiclink exchanged
client-side by stock supabase-js ([Trade-offs](#trade-offs)).

## Client setup

```js
createClient(url, anonKey, {
  auth: {
    storage: localStorage,        // persisted session (not cookies — static site)
    persistSession: true,
    detectSessionInUrl: true,     // picks up the session from the URL fragment —
                                  // both the confirmation redirect and the login
                                  // link redirect carry it there (not in the query)
  },
});
```

## Sessions

- Access token **1 day**, refresh token **1 year** (project settings —
  [project notes](../platform/project.md)). supabase-js auto-refreshes
  and persists the session in localStorage, so a returning visitor with a
  valid refresh token never needs a link again.
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
  a session-independent "check your email to confirm your address"
  screen.
- Backend side effect: the `auth.users` trigger creates the
  [users](../db/users.md) row in `pending`, unconfirmed.
- Errors:
  - email already registered → "already registered — sign in" (the
    sign-in page is the email form; a rejected account gets its rejection
    screen after signing in and cannot re-register).
  - invalid email / invalid display name → stay on the form with the
    message.

## Flow 1b — confirming the email

1. The guest clicks the confirmation link — it points at GoTrue's verify
   endpoint (`/auth/v1/verify?token=...&type=signup&redirect_to=...`),
   which 303-redirects to `https://juneau.love/auth/confirm` **with the
   session in the URL fragment**; `detectSessionInUrl: true` picks it up
   — the account is confirmed and **a session is established** in this
   browser (same mechanism as the login link,
   [Flow 2](#flow-2--log-in-via-the-login-link)).
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
2. Click → the link points at GoTrue's verify endpoint
   (`/auth/v1/verify?token=...&type=magiclink&redirect_to=...`), which
   validates the token and **303-redirects to `https://juneau.love/login`
   with the session in the URL fragment**:

   ```
   #access_token=...&refresh_token=...&token_type=bearer
    &expires_in=...&expires_at=...&type=magiclink
   ```

   There is **no `code=` in the query to exchange** — the session tokens
   *are* the redirect payload. `detectSessionInUrl` reads the fragment
   and installs the session (stock supabase-js, no custom client code).
   The page strips the fragment (`history.replaceState`) so it never
   lingers in history/bookmarks. Verified locally (GoTrue v2.197.0):
   the fragment session works against PostgREST, the refresh token
   refreshes, and the link is **single-use** — a second click on the
   same link redirects with `#error=access_denied&error_code=otp_expired`.
3. From then on it's plain supabase-js session management (auto-refresh,
   persistence, `signOut`).
4. Expired / already-used / invalid link → the redirect carries
   `#error=access_denied&error_code=...` in the fragment → a friendly
   "this link is no longer valid — request a new one" state with a path
   to the email form. GoTrue owns the token's lifetime; a fresh link is
   one tap away.

## Flow 3 — request a link (the only "sign in")

1. Sign-in page: a single email field.
2. POST `send-login-link` `{ email }`:
   - registered **and** approved → a fresh GoTrue magiclink is generated
     and emailed → "a link is on its way".
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
routes to the right screen ([Access by approval
status](../stories/access-by-approval-status.md)).

## Trade-offs

The login link is a native GoTrue magiclink rather than a credential we
store and redeem ourselves: GoTrue generates, stores, expires, and
validates the token, and the client exchanges it with stock supabase-js.
Because GoTrue owns the token, **our schema stores no credential** — the
only state we keep is the send-cooldown timestamp
([users](../db/users.md) `last_login_link_sent_at`). Accepted
trade-offs:

- **GoTrue-managed lifetime, not a longer window we choose** (default ~1
  hour; exact value and configurability unconfirmed). A stale link costs
  one tap on the email form.
- **One exchange per link (verified).** A second click on the same link
  yields `error_code=otp_expired` — a second device requests a fresh
  link, which is exactly the recovery flow.
- **No status re-check at redemption.** A link emailed before a later
  rejection can still be exchanged — the rejected guest gets a session,
  but RLS yields zero rows and the client shows the rejection screen.
  Accepted at this site's scale.
