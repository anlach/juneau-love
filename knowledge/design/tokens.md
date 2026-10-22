---
type: design-token
title: Design tokens (palette, typography, fonts)
description: "The site's visual language: dark plum-ground theme built from the four-pair site palette (lilac text, peach primary actions), Bona Nova serif body + Lavishly Yours script display, and the font licensing note (Bona Nova is a local trial TTF until swapped for woff2)."
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-22T20:15:00Z }
---

# Design tokens

Single source of truth: `:root` custom properties in `src/app.css`, plus the
`@font-face` block at the top of the same file. No component may hard-code
a color or font that has a token.

## Color

Dark theme on a plum ground, built only from the eight-token site palette
(see [Color palette](/color-palette.md)). `:root` declares the raw
`--color-*` palette plus semantic role tokens; every role token is a
`color-mix` derivation of palette tokens, and components reference role
tokens (or `--color-*` for one-off decorative use) — never hard-coded hex.

| Token | Derived from | Use |
|---|---|---|
| `--bg` | `--color-plum` | Page and form-input background (page gets a faint 9% gold radial wash at the top) |
| `--bg-elevated` | plum 88% / lilac 12% | Cards, gallery figures |
| `--text` | `--color-lilac` | Body text, brand, nav, uploader names |
| `--muted` | lilac 75% / plum 25% | Secondary text: `.sub`, `.who`, field labels, `th`, figcaptions |
| `--accent` | `--color-peach` | Links, input focus border |
| `--accent-hover` | `--color-sand` | Link / nav hover |
| `--accent-deep` | terracotta 50% / peach 50% | Primary button border |
| `--border` | gold 35% over transparent | Card / figure hairline borders |
| `--border-soft` | lilac 22% over transparent | Table header rule, ghost-button border |
| `--focus` | `--color-gold` | Focus outlines |
| `--success` | `--color-sage` | `.msg.ok`, approved badge |
| `--error` | terracotta 35% / peach 65% | `.msg.err`, `.btn.danger` |

Primary buttons: `--color-peach` background with `--color-plum` text
(7.9:1), `--color-sand` on hover (9.2:1). Text selection: gold background
with plum text. `color-scheme: dark`; the `theme-color` meta is plum.

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
- One elevation level: soft black shadow on `.card`
  (`0 10px 30px -18px` at 60%); everything else is flat with
  hairline gold borders.

## Layout

- Content column `.frame`: max-width 960px, centered, 1.25rem side
  padding, 4rem bottom padding — shared by the header and `<main>`.
- Dark `color-scheme` only.

## Depends on

- [Components](/components.md) consume these tokens.
