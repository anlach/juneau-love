---
type: design-token
title: Design tokens (theme colors, typography, fonts)
description: "The site's visual language: usage-named color tokens (no hue-based palette) in src/app.css — base colors plus color-mix derivations whose percentages are controls on the /theme page — Bona Nova serif body + Molle handwriting display, dark theme, and the font licensing note (Bona Nova is a local trial TTF until swapped for woff2)."
generated: { by: pi, at: 2026-07-09T00:00:00Z }
---

# Design tokens

Single source of truth: `:root` custom properties in `src/app.css`, plus the
`@font-face` block at the top of the same file. No component may hard-code a
color or font that has a token.

There is **no color palette**. The old four-pair site palette (gold/lilac,
sage/plum, …) is gone; every token is named for what it is *used for*, so any
token can be any color. Shipped defaults currently happen to be a navy/plum
ground with lilac text and a green accent, but nothing in the design depends
on hue.

## Color model: base controls + derived mixes

`:root` declares two layers:

1. **Base controls** — plain hex (or unitless percentage) custom properties,
   one per visible use. The [/theme page](/theme-customization.md) edits
   exactly these and writes them back to `:root` at runtime.
2. **Derived tokens** — pure `color-mix()` formulas over the base controls.
   The theme page never sets these directly; they follow the base values.
   This is what keeps the live site and the theme preview rendering
   identical colors, and what lets hover states follow a general mixing
   rule instead of being hand-picked.

### Base controls

| Token | Kind | Use |
|---|---|---|
| `--bg` | color | Page background, and the fill of text inputs |
| `--text` | color | Body text, brand, nav, uploader names; also the “brighten toward” color for derived surfaces |
| `--link` | color | Links, nav hover, focus outlines, input focus border |
| `--success` | color | `.msg.ok`, approved badge text |
| `--error` | color | `.msg.err`, `.btn.danger` text, rejected badge text |
| `--btn-primary-bg` / `--btn-primary-text` | color | Primary button |
| `--btn-secondary-fill` | color | Secondary button fill hue (rendered as a tint, see derived) |
| `--badge-pending-fill` | color | Pending badge tint hue |
| `--badge-pending-text` | color | Pending badge text |
| `--selection-bg` / `--selection-text` | color | `::selection` |
| `--glow` | color | Top-of-page radial wash, gallery placeholder hatch, landing kicker color |
| `--input-border` | color | Text-field border (functional borders stay) |
| `--table-border` | color | Table header rule and row hairlines (one token, both rules) |
| `--link-hover-mix-with`, `--btn-primary-hover-mix-with`, `--btn-secondary-hover-mix-with`, `--btn-danger-hover-mix-with`, `--menu-hover-mix-with` | color | The color each hover mixes toward |

Base percentages (unitless, consumed as `calc(<name> * 1%)`): `--card-mix`,
`--muted-mix`, `--glow-alpha`, `--btn-secondary-alpha`, `--badge-tint`,
`--link-hover-mix`, `--btn-primary-hover-mix`, `--btn-secondary-hover-mix`,
`--btn-danger-hover-mix`, `--menu-hover-mix`.

### Derived tokens

| Token | Formula |
|---|---|
| `--bg-card` (cards, gallery figures, menu, map frame) | `mix(--bg, --text, --card-mix)` |
| `--text-muted` (secondary text) | `mix(--text, --bg, --muted-mix)` |
| `--link-hover` | `mix(--link, --link-hover-mix-with, --link-hover-mix)` |
| `--btn-primary-bg-hover` | `mix(--btn-primary-bg, …-mix-with, --btn-primary-hover-mix)` |
| `--btn-secondary-bg` (always-on fill) | `--btn-secondary-fill` at `--btn-secondary-alpha` over transparent |
| `--btn-secondary-bg-hover` | `mix(--btn-secondary-fill, …-mix-with, --btn-secondary-hover-mix)` |
| `--btn-danger-bg-hover` | `--btn-danger-hover-mix-with` at `--btn-danger-hover-mix` over transparent |
| `--menu-hover-bg` | `--menu-hover-mix-with` at `--menu-hover-mix` over transparent |
| `--badge-approved-bg` / `--badge-rejected-bg` / `--badge-pending-bg` | tint of `--success` / `--error` / `--badge-pending-fill` at the shared `--badge-tint` over transparent |
| `--glow-color` | `--glow` at `--glow-alpha` over transparent |

**Hover rule (general):** every hover is `mix(base, mix-with, P)` where P and
the mix-with color are theme controls. When the base is transparent (secondary
button, danger button, menu item) the same formula degrades to a tint of the
mix-with color — one mechanism for all hovers.

**Shipped defaults** live in `app.css` and are what visitors without a saved
theme see; the defaults are the starting point for taste, not a palette
constraint. The theme page shows live WCAG contrast ratios for the pairs the
theme produces (4.5:1 AA flagged) because several defaults (muted text on
card, badges, link hover) sit below it and are meant to be tuned.

## No decorative hairlines

Borders are functional only. Cards, gallery figures, the menu dropdown, and
all three button variants are borderless — surfaces separate from the page by
fill contrast (`--bg-card`) plus the one soft shadow level
(`0 10px 30px -18px` at 60% black). The only 1px borders left are input
borders (`--input-border`) and table rules (`--table-border`).

## Typography

| Role | Font | Notes |
|---|---|---|
| Body | `'Bona Nova'`, fallback Georgia / Times serif | 17px / 1.5 line-height, weight 400 (700 = bold, italic available) |
| Display | `'Molle'`, cursive, forced `font-style: italic` | Headings / hero / brand via the `.display` class |

- **Molle** is bundled from npm (`@fontsource/molle`, imported in the root
  layout) — no external font dependency. Its only Google Fonts style is
  italic (weight 400), so the import is the `latin-400-italic` entry point
  (plain `latin.css` is empty for this family) and `.display` must set
  `font-style: italic` — a normal-style request never matches an italic
  face and would fall back to generic cursive.
- **Lavishly Yours** (`@fontsource/lavishly-yours`) remains bundled and
  imported in the root layout but is no longer referenced by any class —
  kept installed on request, a candidate for removal.
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
- One elevation level: soft black shadow on `.card`, gallery figures, the
  menu dropdown, and the map frame; everything else is flat.

## Layout

- Content column `.frame`: max-width 960px, centered, 1.25rem side
  padding, 4rem bottom padding — shared by the header and `<main>`.
- Dark `color-scheme` only.

## Depends on

- [Components](/components.md) consume these tokens.
- [Theme customization](/theme-customization.md) is the runtime that edits
  the base controls.
