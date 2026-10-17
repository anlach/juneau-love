# api-endpoint

* [Current user state (own status + permissions)](current-user-state.md) - The two self-queries the layout runs after a session exists: the user's own users row (approval status) and their effective permission names from the user_permissions view.
* [List registrations (admin)](registration-list.md) - PostgREST read of all users rows that feeds the admin registrations table — display name, email, verified indicator, registration date, approval state, newest first.

# auth-flow

* [Client authentication (passwordless, passcode links)](client-auth.md) - No passwords. Registration is email + display name; initial login is two steps — confirm the email, then click the passcode login link after approval. The link is redeemed by an edge function for a Supabase session (1-day access token, 1-year refresh token, auto-refreshed and persisted by supabase-js).

# edge-function

* [login-with-passcode (redeem a login link)](login-with-passcode.md) - Public edge function that exchanges a valid, unexpired passcode for a Supabase session (1-day access token + 1-year refresh token). Unlimited uses, any device; redemption does not consume the passcode.
* [registration-decision (approve / reject + invite email)](registration-decision.md) - Admin-only edge function that approves or rejects a registration; approving requires a verified email and issues a fresh login passcode plus the invite email, rejecting kills any unredeemed link.
* [send-login-link (sign in / resend link)](send-login-link.md) - Publicly invokable edge function that emails a fresh passcode login link to a given email address, but only if the user is registered and approved; 10-minute cooldown per user.
