---
type: api-endpoint
title: Update own display name
description: The self-PATCH a signed-in user makes to their own users row to change their display name — the only column the guard trigger lets an authenticated user write; on success the client re-reads its own state so the header name follows.
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-24T16:41:54Z }
---

# Update own display name

A signed-in user changes the name the site shows for them by patching their
own `users` row directly — no edge function in the loop. The write is
deliberately thin: `display_name` is the only column the [guard
trigger](../db/users.md) lets `authenticated` write, so the request shape
and the guard agree by construction. There is no server-side validation to
replicate on the client beyond "non-empty" (the column is NOT NULL).

## The request

```
PATCH /rest/v1/users?id=eq.<uid>
Authorization: Bearer <user JWT>
Content-Type: application/json

{ "display_name": "New name" }
```

(`src/routes/change-name/+page.svelte`; `<uid>` is the caller's own id —
RLS's `users_update_own` scopes the row to `auth.uid()`, so a different id
simply matches no row.)

## Rules

- **FE validates first:** the name must be non-empty after trimming; the
  page refuses an empty name with its own message before anything is sent
  (the [story](../stories/change-display-name.md)).
- **Any signed-in user, any approval status.** Neither the RLS policy nor
  the guard conditions on `status`; a `pending` user's name is editable
  too. The page is reachable from the header menu, which every signed-in
  state renders, and directly by URL.
- **On success the client re-reads its own state** ([Current user
  state](/current-user-state.md)) — the header's `.who` is driven by that
  snapshot, not by the PATCH response, so the name in the nav follows
  without a reload.
- **Error expectations:** a hand-crafted self-update of any other column
  (`status`, `email`, `email_confirmed_at`, `last_login_link_sent_at`,
  `admin_notified_at`) raises `users: you may only change your own
  display_name` from the guard even though RLS allows the row.

## Depends on

- [users](../db/users.md) (the row, the self-update RLS policy, the guard)
- [Current user state](/current-user-state.md) (the re-read after save)
- [Change display name](../stories/change-display-name.md) (the flow)
