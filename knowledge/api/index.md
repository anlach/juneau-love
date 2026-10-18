# api-endpoint

* [Current user state (own status + permissions)](current-user-state.md) - The two self-queries the layout runs after a session exists: the user's own users row (approval status) and their effective permission names from the user_permissions view.
* [List registrations (admin)](registration-list.md) - PostgREST read of all users rows that feeds the admin registrations table — display name, email, verified indicator, registration date, approval state, newest first.

# auth-flow

* [Client authentication (passwordless, login links)](client-auth.md) - No passwords. Registration is email + display name; initial login is two steps — confirm the email, then click the login link in an email after approval. The link is a native GoTrue magiclink exchanged client-side for a Supabase session (1-day access token, 1-year refresh token, auto-refreshed and persisted by supabase-js) with stock mechanics.

# edge-function

* [asset-upload-url (presigned image upload)](asset-upload-url.md) - Planned edge function that issues a one-off presigned S3 PUT (15-min TTL) for an approved guest — key chosen server-side, content-type and size limits enforced up front.
* [asset-url (presigned image GET URLs)](asset-url.md) - Edge function that exchanges asset ids for short-lived (15-min) presigned S3 GET URLs — but only for rows the caller's RLS allows. The only way browser code ever sees an image byte.
* [registration-decision (approve / reject + invite email)](registration-decision.md) - Admin-only edge function that approves or rejects a registration; approving requires a verified email and emails the guest a fresh login link (a GoTrue magiclink), rejecting ends link eligibility.
* [send-login-link (sign in / resend link)](send-login-link.md) - Publicly invokable edge function that emails a fresh GoTrue magiclink login link to a given email, but only if the user is registered and approved; 10-minute cooldown per user.
