---
type: design-decision
title: What renders where (prerendered vs client-rendered)
description: "Only the public landing / is prerendered; every session- or status-dependent route is client-rendered behind the adapter-static SPA fallback (404.html), so no user-specific data ever reaches prerendered HTML."
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-11-23T02:29:10Z }
---

# What renders where

The site is `adapter-static` on GitHub Pages with no server. That decides
the render mode of every route, and the decision rule is:

> If what the page shows depends on a session, the approval status, or RBAC
> permissions, it **renders client-side only**.

| Route | Mode | Why |
|---|---|---|
| `/` | **prerendered** (`prerender = true` in `src/routes/+page.ts`) | The landing's neutral "Loading…" line ([Landing page](/landing.md)); the real variant — public invitation or a signed-in screen — paints client-side once the session check resolves |
| `/login`, `/register`, `/auth/confirm` | client (`ssr = false`) | Session-dependent (fragment session exchange, "already signed in" state) |
| `/gallery` | client (`ssr = false`) | Gated on `status = 'approved'` |
| `/things-to-do` | client (`ssr = false`) | Gated on `status = 'approved'` |
| `/rsvp`, `/change-name`, `/whale-watching` | not prerendered (served through the SPA fallback) | Gated on `status = 'approved'`; no `prerender = true`, so the build emits no HTML for them and the fallback shell renders client-side |
| `/registrations` | client (`ssr = false`) | Gated on `registrations:read` |

## Mechanics

- `adapter-static({ fallback: '404.html' })`: the fallback is the
  client-rendered app shell, so **every deep link works** on GitHub Pages —
  the static host serves `404.html` for unknown paths and the app takes
  over. It also replaces GitHub Pages' default 404 page.
- `+layout.ts` has no global prerender flag; the per-route `prerender` /
  `ssr` settings above are the whole of the render configuration.
- Session state resolves client-side after hydration (`initAuth()` in the
  root layout — [Client authentication](../api/client-auth.md)). The
  prerendered landing shell is therefore its **loading line, not the
  public invitation** ([Landing page](/landing.md)): a returning signed-in
  visitor sees a neutral "Loading…" for the duration of the session +
  state fetch, then their real screen — the "You're invited" hero never
  flashes first. Consequences, accepted: a no-JS visitor sees "Loading…"
  indefinitely (they cannot register or sign in without JS anyway), and
  anonymous visitors' hero paints one round-trip later than it would if
  it were the prerendered shell. Either way the prerendered HTML stays
  free of personal data.

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
