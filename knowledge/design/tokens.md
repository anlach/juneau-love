---
type: design-token
title: Design tokens (palette, typography, fonts)
description: "The site's visual language: warm cream/ink/rose palette, Bona Nova serif body + Lavishly Yours script display, and the font licensing note (Bona Nova is a local trial TTF until swapped for woff2)."
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-19T04:46:00Z }
---

# Design tokens

Single source of truth: `:root` custom properties in `src/app.css`, plus the
`@font-face` block at the top of the same file. No component may hard-code
a color or font that has a token.

## Color

| Token | Value | Use |
|---|---|---|
| `--cream` | `#fbf7f1` | Page background (with a soft rose radial wash at the top) |
| `--ink` | `#4a4038` | Primary text, brand, links (unvisited state is rose-deep) |
| `--muted` | `#8d8177` | Secondary text, `.sub` copy, field labels, table headers |
| `--rose` | `#b76e79` | Primary accent: buttons, brand dot, focus rings, selection |
| `--rose-deep` | `#a15a66` | Hover state, links, ghost-button text |

Semantic colors for feedback (defined where used, consistent values):
success `#4c6b4f`, error `#9b4a3f`.

## Typography

| Role | Font | Notes |
|---|---|---|
| Body | `'Bona Nova'`, fallback Georgia / Times serif | 17px / 1.5 line-height, weight 400 (700 = bold, italic available) |
| Display | `'Lavishly Yours'`, cursive | Headings / hero / brand via the `.display` class |

- **Lavishly Yours** is bundled from npm (`@fontsource/lavishly-yours`,
  imported in the root layout) — no external font dependency.
- **Bona Nova is a local trial**: full TTFs committed under `static/fonts/`
  (Regular / Italic / Bold) and loaded via `@font-face` with `font-display:
  swap`. **Before production these must be swapped for woff2 subsets**
  (license permitting) — the TTFs are ~1 MB each.
- Type scale is set per-page with inline `font-size` on the `.display`
  heading (e.g. 4.5rem hero, 2–2.6rem page titles, 2rem card titles).
- Copy uses typographic apostrophes (`’`), not straight ones — e2e copy
  assertions match the apostrophe with a `.` wildcard (`/you.re/i`) so a
  straight/curly typo can’t break a test.

## Shape / elevation

- Rounded pills for interactive elements (`.btn`, `.badge`: 999px),
  8–12px radii for inputs/cards, 10px for gallery figures.
- One elevation level: soft shadow on `.card`
  (`0 10px 30px -18px` of `--ink` at 35%); everything else is flat with
  hairline rose-tinted borders.

## Layout

- Content column `.frame`: max-width 960px, centered, 1.25rem side
  padding, 4rem bottom padding — shared by the header and `<main>`.
- Light `color-scheme` only.

## Depends on

- [Components](/components.md) consume these tokens.
