-- Gallery photo deletion (knowledge/stories/delete-photos.md,
-- knowledge/db/assets.md): an approved guest may delete their own uploads;
-- an admin (RBAC role) may delete any row. The policy is the security
-- boundary — the asset-delete edge function performs the DELETE as the
-- calling user and relies on it (a rejected row is silently skipped), and
-- a hand-crafted Data API DELETE is scoped to exactly this predicate.
--
-- Gated on is_approved() like the other policies: a pending or rejected
-- user owns no deletable rows — a rejected uploader's photos remain in the
-- gallery (knowledge/stories/guest-gallery.md), so they stay out of reach.
create policy assets_delete_own_or_admin on public.assets
  for delete to authenticated
  using (public.is_approved() and (user_id = auth.uid() or public.has_role('admin')));

-- Mirrors the policy surface (DML grants only where a client DML policy
-- exists); the grant without the policy would be the hole.
grant delete on public.assets to authenticated;
