---
type: db-table
title: assets
description: "Metadata for images stored in a private external S3 bucket — one row per image (original + client-generated thumbnail); admin-seeded or guest-uploaded. The bytes live in S3, and RLS decides which approved guests may see (and get a presigned URL for) each row."
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-27T18:43:43Z }
verified:
  - { by: pi/Qwen3.8-27B-TEE, at: 2026-10-20T07:14:32Z }
  - { by: pi/Qwen3.8-27B-TEE, at: 2026-10-27T18:43:43Z }
  - { by: pi/Qwen3.8-27B-TEE, at: 2026-10-28T06:07:06Z }
---

# assets

One row per image the site shows. The **bytes live in a private
external S3 bucket** (hosted: Hippius; local dev: the local stack's
storage S3 — endpoints, credentials, and gateway quirks in [Supabase
project](../platform/project.md#assets-s3-hippius-local-stack)) — not in the GitHub
repo and not in Supabase Storage (the Supabase instance is on the free
tier; this table keeps image weight off its file-storage quota). This
table is the authorization boundary: [RLS](#rls) decides who may see a
row, and the
[asset-url](../api/asset-url.md) edge function signs an S3 URL **only**
for rows the caller can read. The bucket itself is not enumerable by
clients, and its keys are random.

# Why client-side thumbnails

The gallery grid shows a **client-generated WebP thumbnail** and
serves the full-size original on demand ([guest
gallery](../stories/guest-gallery.md)). On-the-fly transforms were
ruled out by investigation (verified against the live docs,
2026-10-27):

- **Supabase image transformations only transform objects stored in
  Supabase Storage.** They are a component inside the Storage service
  (imgproxy); the render endpoints are pinned to
  `<project>.supabase.co/storage/v1/render/...` and there is no mode
  that targets an external S3 bucket. They are also gated to the Pro
  plan and up (free tier: not included).
- **Hippius S3 has no transform/resize API** (full compatibility
  matrix checked). Its CDN product caches objects near visitors but
  does not resize, and a zone over a private bucket makes every object
  under its prefix publicly readable — incompatible with this
  bucket's private, presigned-only model
  ([Supabase project](../platform/project.md#assets-s3-hippius-local-stack)).

So the thumbnail is a derived object the client creates at upload
(original and thumbnail uploaded as two objects, both keys in this
table), with a one-off admin backfill for the seeded photos. Thumbnail
objects live in the same private bucket under a `thumbs/` key prefix.

# Schema

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` PK | `default gen_random_uuid()`. |
| `user_id` | `uuid` NOT NULL | `references users(id) on delete cascade`. Uploader/owner; for admin-seeded images the admin's own `users.id`. The gallery shows the uploader's display name via this join. |
| `s3_key` | `text` NOT NULL UNIQUE | Object key in the private bucket, e.g. `uploads/<user_id>/<uuid>`. Random and unguessable; this table is the only place keys are listed. |
| `thumb_s3_key` | `text` UNIQUE | Object key of the client-generated WebP thumbnail, e.g. `thumbs/<user_id>/<uuid>.webp`. Nullable: rows created before the backfill carry NULL until it runs, and the gallery falls back to the full-size URL for them. |
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
  thumb_s3_key text unique,
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

-- Read-only for client roles: Supabase's default privileges hand
-- them full DML on public objects, and DML through a definer view
-- runs with the owner's privileges (bypassing users RLS).
revoke all on public.guest_names from anon, authenticated;
grant select on public.guest_names to authenticated;
```

Indexes: `s3_key`'s unique constraint carries its own index; plus
`assets_user_id_idx (user_id)` (FK) and `assets_created_at_idx
(created_at desc)` for the gallery's newest-first read. No index on
caption or the other columns — no v1 access pattern needs one.

It exists because [users](/users.md) RLS lets a guest read only
their own row, so an embedded `users(display_name)` join would come
back NULL for every other uploader. The view exposes only
`(id, display_name)`; `is_approved()` keeps unapproved callers at
zero rows, and `status = 'approved'` keeps pending/rejected names
out of the result even for approved callers.

**Read-only for client roles.** The owner-privilege escape that
lets the view span [users](/users.md) RLS also makes it a DML
channel: before the revoke above, an approved guest's `DELETE
/rest/v1/guest_names?id=eq.…` ran with the owner's privileges,
deleted any approved user, and the FK cascade took their assets
rows (and the gallery images behind them) with it
([Bug list](../platform/bugs.md), 2026-10-26 entry). The revoke
pins the view's client surface to `select` for `authenticated`;
the [users delete guard](/users.md) is the backstop that refuses
the delete even if a future grant reopened DML on a definer view.

# Access patterns

- **Seeding (admin, out-of-band):** the admin uploads objects to the
  S3 bucket with their own S3 tooling, then inserts the rows in the
  Supabase SQL editor with `user_id` = the admin's `users.id`. The
  console is the project owner, so the insert bypasses RLS — the same
  accepted convention as [users](/users.md) bootstrap. **Thumbnail
  backfill** is the same convention, one-off: generate each seeded
  photo's thumbnail, upload it under `thumbs/…`, and set
  `thumb_s3_key` on the row.
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
  batched call and renders the returned presigned **thumbnail** URLs
  (15-minute TTL) as `<img src>`, caching them client-side until near
  expiry; the full-size URL from the same call is used only on demand.
- **Guest upload:** [asset-upload-url](../api/asset-upload-url.md)
  chooses both keys server-side (original and thumbnail) and returns
  presigned PUTs for each; the browser generates the thumbnail first,
  uploads both bytes, then the client inserts the row via PostgREST
  (INSERT policy below).
- **No client UPDATE/DELETE in v1:** removal is out-of-band (see [guest
  gallery](../stories/guest-gallery.md)).

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

**Data API grants:** `service_role` — all four; `authenticated` —
`select, insert` (mirrors the policies, no `update`/`delete`);
`anon` — `select` only (zero rows, no anon policy). The `guest_names`
view is pinned read-only for client roles: `select` to
`authenticated` only, with the default-privilege DML revoked from
`anon` and `authenticated` (see the view's grant block above).
