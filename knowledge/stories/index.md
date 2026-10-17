# user-story

* [Access by approval status](access-by-approval-status.md) - A signed-in user's screen is determined by their approval state — pending sees an awaiting screen, rejected sees a rejection screen, approved sees guest content (admins additionally the registrations page); sessions last via 1-day access + 1-year refresh tokens.
* [Register as a guest](register-as-guest.md) - A guest registers with email and display name (no password); the registration starts in pending state, the guest confirms their email, and then it waits for an admin decision.
* [Review registrations (admin)](review-registrations.md) - The admin opens a registrations page listing every registration with its verification and approval state, and can approve (verified emails only) or reject each one; approving emails the guest their login link.
* [Sign in with a login link (passcode)](sign-in-with-login-link.md) - An approved guest gets a session by clicking a passcode link in an email — valid 7 days, unlimited uses, any device; a lost or expired session is recovered by entering the guest's email to get a fresh link.
