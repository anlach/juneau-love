# db-table

* [permissions](permissions.md) - Named RBAC permissions, namespaced as area:action. Seeded with the three registrations permissions; all three belong to the admin role in v1.
* [role_permissions](role_permissions.md) - Join table granting permissions to roles. Seeded so the admin role holds all three registrations permissions; the guest role holds none in v1.
* [roles](roles.md) - Named RBAC roles. Seeded with admin and guest; the guest role is granted and revoked automatically by registration approval, the admin role is assigned only out-of-band.
* [user_permissions](user_permissions.md) - Read-only view resolving each user's effective permission names (user_roles x role_permissions x permissions). The FE queries it for the current user to gate the UI.
* [user_roles](user_roles.md) - Join table assigning roles to users. The guest role is written only by the users status-sync trigger; the admin role only by out-of-band bootstrap. No client DML.
* [users](users.md) - One row per registered site user — the registration record with approval status. Credentials live in Supabase Auth (auth.users); this table holds the profile and approval state the site uses for authorization.
