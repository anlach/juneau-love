# component

* [Shared components and conventions](components.md) - The class-based component kit in src/app.css (frame/header/nav, card, buttons, fields, messages, badges, table, gallery grid, the header account menu) plus the StateScreen component for the signed-in status screens.

# design-decision

* [What renders where (prerendered vs client-rendered)](prerender.md) - Only the public landing / is prerendered; every session- or status-dependent route is client-rendered behind the adapter-static SPA fallback (404.html), so no user-specific data ever reaches prerendered HTML.

# design-token

* [Color palette](color-palette.md) - The site's four primary/secondary color pairs (gold/lilac, sage/plum, terracotta/peach, slate/sand): hex values, the --color-* custom properties in app.css, tentative role assignments, contrast limits, and the standalone swatch page (color-palette.html).
* [Design tokens (palette, typography, fonts)](tokens.md) - The site's visual language: dark plum-ground theme built from the four-pair site palette (lilac text, peach primary actions), Bona Nova serif body + Lavishly Yours script display, and the font licensing note (Bona Nova is a local trial TTF until swapped for woff2).
