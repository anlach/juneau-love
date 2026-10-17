# api-endpoint

* [Approve / reject a registration](registration-decision.md) - Admin sets a user's status to approved or rejected via a PostgREST update; DB triggers enforce the transition and grant or revoke the guest role in the same transaction.
* [Current user state (own status + permissions)](current-user-state.md) - The two self-queries the layout runs after a session exists: the user's own users row (approval status) and their effective permission names from the user_permissions view.
* [List registrations (admin)](registration-list.md) - PostgREST read of all users rows that feeds the admin registrations table — display name, email, registration date, approval state, newest first.

# auth-flow

* [Client authentication (signup, sign-in, session)](client-auth.md) - The browser-side Supabase Auth flow: password signup creates a pending registration via a DB trigger, sign-in works for every status, and the layout gates screens on the user's approval state.
