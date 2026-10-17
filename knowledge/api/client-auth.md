---
type: auth-flow
title: Client authentication (signup, sign-in, session)
description: "The browser-side Supabase Auth flow: password signup creates a pending registration via a DB trigger, sign-in works for every status, and the layout gates screens on the user's approval state."
status: draft
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-17T20:35:00Z }
---

# Client authentication

All auth happens in the browser against Supabase Auth with the **anon**
key; RLS is the security boundary (repo architecture — no service key
ever reaches the client, no `@supabase/ssr` cookie hooks, no server at
runtime).

## Client setup

```js
createClient(url, anonKey, {
  auth: {
    storage: localStorage,        // persisted session
    persistSession: true,
    detectSessionInUrl: true,     // handle ?code= links (e.g. future OAuth)
  },
});
```

## Operations

| Operation | supabase-js call | Notes |
|---|---|---|
| Register | `supabase.auth.signUp({ email, password, options: { data: { display_name } } })` | See registration contract below. |
| Sign in | `supabase.auth.signInWithPassword({ email, password })` | Works regardless of approval status — a pending/rejected user *can* sign in and sees their state screen. |
| Sign out | `supabase.auth.signOut()` | |
| Session | `getSession()` / `onAuthStateChange(...)` | Layout restores the session on load, then fetches the current user's state (`knowledge/api/current-user-state.md`). |

## Registration contract (signUp)

- **Request:** email, password (Supabase default minimum 6 chars — FE
  validates before calling), and `options.data.display_name` (required;
  the DB trigger raises if it is missing, which rolls back the whole
  signup — no auth user without a profile row).
- **Backend side effect:** the `auth.users` insert trigger creates the
  [users](../db/users.md) row in `status = 'pending'`. No client code
  writes to `users`.
- **Success:** with **email confirmation disabled** (project setting — a
  setup requirement for v1), `signUp` returns a live session
  immediately and the user lands on the "awaiting approval" screen.
- **Errors:**
  - email already registered → Supabase "User already registered": the
    account exists (possibly approved or rejected). FE: point to sign-in;
    a rejected user sees the rejection screen after signing in and cannot
    re-register.
  - invalid email / weak password → show the message, stay on the form.

## After auth

The auth layer only establishes *who* the user is. *What they may see* is
resolved from the database: the layout fetches the user's `users` row
(status) and effective permissions, then routes to the appropriate screen
(`knowledge/stories/access-by-approval-status.md`).

## Out of scope in v1

- No edge functions, no service-role calls, no OAuth/social providers,
  no password-reset UI (Supabase's built-in reset email works if enabled).
- No email notification on approval/rejection (open question — would need
  an edge function later).
