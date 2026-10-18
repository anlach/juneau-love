# db-schema

* [RBAC (roles, permissions, grants)](rbac.md) - The access-control catalog — roles, permissions, and the join tables assigning them — plus the user_permissions view the FE queries to gate the UI. In v1 permissions express admin capabilities only; guest content is gated on approval state, not permissions.

# db-table

* [assets](assets.md) - Metadata for images stored in a private external S3 bucket — one row per image (admin-seeded or guest-uploaded); the bytes live in S3, and RLS decides which approved guests may see (and get a presigned URL for) each row.
* [users](users.md) - One row per registered site user — the registration record with approval status. Users have no password and log in via short-lived GoTrue magiclinks (no credential lives in this table); email-verification state is mirrored from auth.users.
