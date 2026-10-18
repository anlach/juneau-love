---
type: db-table
title: assets
description: "Metadata for images stored in a private external S3 bucket — one row per image (admin-seeded or guest-uploaded); the bytes live in S3, and RLS decides which approved guests may see (and get a presigned URL for) each row."
status: draft
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-18T03:00:23Z }
---

# assets

One row per image the site shows. The **bytes live in a private
external S3 bucket** — not in the GitHub repo and not in Supabase
Storage (the Supabase instance is on the free tier; this table keeps
image weight off its file-storage quota). This table is the
authorization boundary: [RLS](#rls) decides who may see a row, and the
[asset-url](../api/asset-url.md) edge function signs an S3 URL **only**
for rows the caller can read. The bucket itself is not enumerable by
clients, and its keys are random.

# Schema

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` PK | `default gen_random_uuid()`. |
| `user_id` | `uuid` NOT NULL | `references users(id) on delete cascade`. Uploader/owner; for admin-seeded images the admin's own `users.id`. The gallery shows the uploader's display name via this join. |
| `s3_key` | `text` NOT NULL UNIQUE | Object key in the private bucket, e.g. `uploads/<user_id>/<uuid>`. Random and unguessable; this table is the only place keys are listed. |
| `content_type` | `text` NOT NULL | `image/jpeg`, `image/png`, or `image/webp` (CHECK). Must match the S3 object's `Content-Type` so presigned GETs serve the right type. |
| `byte_size` | `bigint` NOT NULL | Object size in bytes; checked against the upload limit before a PUT is signed. |
| `caption` | `text` | Optional; shown under the image in the gallery. |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | Gallery order (newest first). |

Target DDL:

```sql
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  s3_key text not null unique,
  content_type text not null
    check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size bigint not null check (byte_size > 0),
  caption text,
  created_at timestamptz not null default now()
);
```

Helper function (mirrors the [has_role](/users.md) pattern;
`SECURITY DEFINER` so the policies below do not recurse into
[users](/users.md) RLS):

```sql
create or replace function public.is_approved()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and status = 'approved'
  );
$$;
```

Name-join view (also runs as owner via
`security_invoker = off`, so it is exempt from
[users](/users.md) RLS; the view's own `WHERE` is the only gate):

```sql
create view public.guest_names with (security_invoker = off)
as select id, display_name
from public.users
where status = 'approved' and public.is_approved();

grant select on public.guest_names to authenticated;
```

It exists because [users](/users.md) RLS lets a guest read only
their own row, so an embedded `users(display_name)` join would come
back NULL for every other uploader. The view exposes only
`(id, display_name)`; `is_approved()` keeps unapproved callers at
zero rows, and `status = 'approved'` keeps pending/rejected names
out of the result even for approved callers.

# Access patterns

- **Seeding (admin, out-of-band):** the admin uploads objects to the
  S3 bucket with their own S3 tooling, then inserts the rows in the
  Supabase SQL editor with `user_id` = the admin's `users.id`. The
  console is the project owner, so the insert bypasses RLS — the same
  accepted convention as [users](/users.md) bootstrap.
- **Gallery read:** any approved guest `select`s all rows ordered
  `created_at desc`, then fetches the uploaders' display names from
  the [`guest_names`](/assets.md) view in a second batched query
  (`where id in (<uploader ids>)`) and joins client-side. The
  PostgREST embed syntax cannot be used: it infers relations from
  FKs, and a view has none (see
  [guest gallery](../stories/guest-gallery.md)).
- **Uploader name visibility:** via `guest_names`, an approved guest
  sees the display names of *approved* users only — never names of
  pending/rejected users. The admin sees all names through the
  [users](/users.md) admin-read policy.
- **Getting image bytes:** the FE never constructs S3 URLs. It passes
  the asset ids it can see to [asset-url](../api/asset-url.md) in one
  batched call and renders the returned presigned GET URLs (15-minute
  TTL) as `<img src>`, caching them client-side until near expiry.
- **Guest upload (planned):** [asset-upload-url](../api/asset-upload-url.md)
  chooses the key server-side and returns a presigned PUT; the browser
  uploads the bytes, then the client inserts the row via PostgREST
  (INSERT policy below).
- **No thumbnails in v1:** full-size objects are served as-is.
  Resizing / derived assets are deferred (open question).
- **No client UPDATE/DELETE in v1:** removal is out-of-band (delete the
  S3 object, then the row) or a later admin path.

# RLS

RLS is enabled but **not** forced — the owner bypass is what makes
seeding work, consistent with [users](/users.md).

| Policy | Op | Predicate |
|---|---|---|
| `assets_read_approved` | SELECT | `using (public.is_approved())` |
| `assets_insert_own` | INSERT | `with check (user_id = auth.uid() and public.is_approved())` |

The INSERT predicate is deliberately gated on approval: a
confirmed-but-pending user (who already holds a session from
email-verification) must not be able to plant gallery rows that would
appear to guests later. No UPDATE or DELETE policies in v1, and no
policy for `anon` — unauthenticated, pending, and rejected users see
zero rows and therefore can never obtain a presigned URL for any image.
