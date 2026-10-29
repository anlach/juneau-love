-- Gallery thumbnails (knowledge/db/assets.md,
-- knowledge/stories/guest-gallery.md): every image carries a
-- client-generated WebP thumbnail in the same private bucket under a
-- thumbs/ key prefix; this column holds its key. Nullable on purpose —
-- rows that predate the feature (and the one-off admin backfill) carry
-- NULL, and the gallery falls back to the full-size URL for them. The
-- unique constraint is the same "only this table lists keys" rule as
-- s3_key.
alter table public.assets add column thumb_s3_key text unique;
