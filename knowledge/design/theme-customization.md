---
type: design-decision
title: Theme customization (admin theme page)
description: "The /theme page: every base color and mix percentage in [Design tokens](/tokens.md) is a control (color pickers + % inputs) with a live preview pane of the real components, static hover twins, and a WCAG contrast check. FE-only for now — the theme saves to localStorage and is per-browser; the page is intentionally ungated for the time being."
generated: { by: pi, at: 2026-07-09T00:00:00Z }
---

# Theme customization

The `/theme` page is where the site's colors get chosen. It edits the base
controls of the token model in [Design tokens](/tokens.md) — the hex colors
and the mix percentages/mix-with colors that the derived `color-mix` tokens
consume — and a preview pane shows the effect immediately.

## Access

- **Not gated.** Any visitor can open `/theme`. The theme is per-browser
  (localStorage), so an ungated page affects no shared state — opening it up
  costs nothing, and guests customizing their own view is the eventual
  direction anyway. The **nav link "Theme" is shown to signed-in users only**
  (root layout, after "Registrations"); signed-out visitors don't see it.
- Gating it later (e.g. an RBAC permission) is a one-line change in the root
  layout nav.

## Page layout

Two columns inside the usual `.frame`, **each with its own scrollbar**
(`max-height` + `overflow-y: auto`):

- **Left — controls.** Grouped sections (Page, Text, Surfaces, Links &
  focus, Primary button, Secondary button, Danger button, Inputs & table,
  Feedback & badges, Menu). Each row is a label + a native
  `<input type="color">` (with the hex echoed next to it) or a 0–100 number
  input for percentages, wired to `setThemeValue` on `input` so the page
  reacts while the picker is being dragged. A **Reset to defaults** button
  restores the shipped `app.css` defaults and drops the saved theme.
- **Right — preview.** Representative samples of *everything the theme
  touches*, built from the real component classes so the preview is
  WYSIWYG: display + body + muted + bold/italic text, kicker, a real link
  and a painted link-hover twin, brand, surface swatches (page / card /
  selection), a card holding all button variants — primary, secondary,
  danger, disabled — each with a static **"(hover)" twin painted with the
  derived hover color as its actual background** (real hovers can't be seen
  while the mouse is on the pickers), inputs (live + a static focused
  sample), ok/err messages, the three badges, a table with small buttons, a
  gallery figure with the hatched placeholder, a static menu with a hover
  twin, and a **live WCAG contrast list** (body/muted on page and card,
  link, button text on fill/hover-fill, badge text on chip, selection) with
  anything under 4.5:1 flagged in the error color.

## State & persistence

`src/lib/theme.svelte.ts` is the single source for runtime theme values:

- `THEME_VARS` — the full control catalog (CSS var name, kind, shipped
  default); the catalog and the `:root` defaults in `app.css` must stay in
  lockstep.
- `theme` — module-level `$state` shared by the root layout (applies the
  saved theme on mount via `initTheme()`) and the page (edits via
  `setThemeValue`, `resetTheme`).
- Applying = writing the base custom properties onto
  `document.documentElement` inline; the derived tokens recompute in CSS.
- Persistence = `localStorage` under key `juneau.theme.v1`, saved on every
  change (there is no save button). Saved values are validated on load
  (hex shape / 0–100 number) and anything malformed falls back to the
  shipped default.
- **Per-browser by design for now**: there is no server storage, so a
  customized theme is visible only in the browser that set it; everyone else
  sees the shipped defaults. A shared (server-stored) theme is the expected
  next step, not part of this design.

## Buttons

Three visual variants, all borderless (see [Design tokens](/tokens.md#no-decorative-hairlines)):
`.btn` primary (filled), `.btn.secondary` (subtle always-on tinted fill —
the class renamed from `.ghost` when it gained the fill), `.btn.danger`
(error text only). `.small` is a size modifier, not a type.

## Depends on

- [Design tokens](/tokens.md) — the token model and the no-hairline rule.
- [Components](/components.md) — the component kit the preview renders.
