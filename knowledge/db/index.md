# db-table

* [assets](assets.md) - Metadata for images stored in a private external S3 bucket — one row per image (admin-seeded or guest-uploaded); the bytes live in S3, and RLS decides which approved guests may see (and get a presigned URL for) each row.
* [login_passcodes](login_passcodes.md) - One row per user holding the current login passcode — a 7-day, unlimited-use bearer credential carried in an emailed link. Written and read only by edge functions (service role); no client can ever see it.
* [permissions](permissions.md) - Named RBAC permissions, namespaced as area:action. Seeded with the three registrations permissions; all three belong to the admin role in v1.
* [role_permissions](role_permissions.md) - Join table granting permissions to roles. Seeded so the admin role holds all three registrations permissions; the guest role holds none in v1.
* [roles](roles.md) - Named RBAC roles. Seeded with admin and guest; the guest role is granted and revoked automatically by registration approval, the admin role is assigned only out-of-band.
* [user_permissions](user_permissions.md) - Read-only view resolving each user's effective permission names (user_roles x role_permissions x permissions). The FE queries it for the current user to gate the UI.
* [user_roles](user_roles.md) - Join table assigning roles to users. The guest role is written only by the users status-sync trigger; the admin role only by out-of-band bootstrap. No client DML.
* [users](users.md) - One row per registered site user — the registration record with approval status. Users have no password; the login credential (passcode) lives in login_passcodes, and email-verification state is mirrored from auth.users.
