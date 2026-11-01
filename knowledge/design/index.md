# component

* [Gallery selection & batch-actions UI](selection-actions.md) - Per-cell checkbox in the gallery grid (hover- or focus-revealed, always visible while any selection is active) and the toolbar action group — Download, plus Delete with its own enablement — the presentation layer for both batch actions.
* [Shared components and conventions](components.md) - The class-based component kit in src/app.css (frame/header/nav, card, buttons, fields, messages, badges, table, gallery grid, the header account menu) plus the StateScreen component for the signed-in status screens.

# design-decision

* [Gallery thumbnail rendering](gallery-thumbnails.md) - The gallery grid shows the client-generated WebP thumbnail at its natural aspect ratio — width-constrained, never cropped or stretched — in a box that hugs the thumbnail and centers vertically in its row; 'opening an image' is a plain link that opens the full-size original in a new tab. Rows without a thumbnail fall back to the full-size URL.
* [Theme customization (admin theme page)](theme-customization.md) - The /theme page: every base color and mix percentage in [Design tokens](/tokens.md) is a control (color pickers + % inputs) with a live preview pane of the real components, static hover twins, and a WCAG contrast check. FE-only for now — the theme saves to localStorage and is per-browser; the page is intentionally ungated for the time being.
* [What renders where (prerendered vs client-rendered)](prerender.md) - Only the public landing / is prerendered; every session- or status-dependent route is client-rendered behind the adapter-static SPA fallback (404.html), so no user-specific data ever reaches prerendered HTML.

# design-token

* [Design tokens (theme colors, typography, fonts)](tokens.md) - The site's visual language: usage-named color tokens (no hue-based palette) in src/app.css — base colors plus color-mix derivations whose percentages are controls on the /theme page — Bona Nova serif body + Molle handwriting display, dark theme, and the font licensing note (Bona Nova is a local trial TTF until swapped for woff2).
