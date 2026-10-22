---
type: design-decision
title: What renders where (prerendered vs client-rendered)
description: "Only the public landing / is prerendered; every session- or status-dependent route is client-rendered behind the adapter-static SPA fallback (404.html), so no user-specific data ever reaches prerendered HTML."
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-19T04:46:00Z }
---

# What renders where

The site is `adapter-static` on GitHub Pages with no server. That decides
the render mode of every route, and the decision rule is:

> If what the page shows depends on a session, the approval status, or RBAC
> permissions, it **renders client-side only**.

| Route | Mode | Why |
|---|---|---|
| `/` | **prerendered** (`prerender = true` in `src/routes/+page.ts`) | The public invitation; the signed-in variants of it hydrate in place after the client-side auth check |
| `/login`, `/register`, `/auth/confirm` | client (`ssr = false`) | Session-dependent (fragment session exchange, "already signed in" state) |
| `/gallery` | client (`ssr = false`) | Gated on `status = 'approved'` |
| `/registrations` | client (`ssr = false`) | Gated on `registrations:read` |

## Mechanics

- `adapter-static({ fallback: '404.html' })`: the fallback is the
  client-rendered app shell, so **every deep link works** on GitHub Pages —
  the static host serves `404.html` for unknown paths and the app takes
  over. It also replaces GitHub Pages' default 404 page.
- `+layout.ts` has no global prerender flag; the per-route `prerender` /
  `ssr` settings above are the whole of the render configuration.
- Session state resolves client-side after hydration (`initAuth()` in the
  root layout — [Client authentication](../api/client-auth.md)), so a
  returning signed-in visitor briefly sees the anonymous shell before the
  real screen. Accepted: it is one script round-trip, and it is what keeps
  the prerendered HTML free of personal data.

## Consequences

- **Never bake user-specific or approval-specific data into prerendered
  HTML** — prerendered pages are fetchable by URL by anyone. The
  unauthenticated session must see zero rows via RLS regardless
  ([Access by approval status](../stories/access-by-approval-status.md)).
- The dev server origin stays `http://localhost:3000` (matching
  `site_url` in `supabase/config.toml`) so local auth links resolve;
  e2e serves the production build via `vite preview` on `:4173`
  (`playwright.config.ts`).
- Served from the root of the custom domain (juneau.love) — no base path.

## Depends on

- [Client authentication](../api/client-auth.md)
- [Access by approval status](../stories/access-by-approval-status.md)
