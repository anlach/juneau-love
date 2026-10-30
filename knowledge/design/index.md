# component

* [Gallery selection & batch-actions UI](selection-actions.md) - Per-cell checkbox in the gallery grid (hover- or focus-revealed, always visible while any selection is active) and the toolbar action group — Download, plus Delete with its own enablement — the presentation layer for both batch actions.
* [Shared components and conventions](components.md) - The class-based component kit in src/app.css (frame/header/nav, card, buttons, fields, messages, badges, table, gallery grid, the header account menu) plus the StateScreen component for the signed-in status screens.

# design-decision

* [Gallery thumbnail rendering](gallery-thumbnails.md) - The gallery grid shows the client-generated WebP thumbnail at its natural aspect ratio — width-constrained, never cropped or stretched — in a box that hugs the thumbnail and centers vertically in its row; 'opening an image' is a plain link that opens the full-size original in a new tab. Rows without a thumbnail fall back to the full-size URL.
* [What renders where (prerendered vs client-rendered)](prerender.md) - Only the public landing / is prerendered; every session- or status-dependent route is client-rendered behind the adapter-static SPA fallback (404.html), so no user-specific data ever reaches prerendered HTML.

# design-token

* [Color palette](color-palette.md) - The site's four primary/secondary color pairs (gold/lilac, sage/plum, terracotta/peach, slate/sand): hex values, the --color-* custom properties in app.css, tentative role assignments, contrast limits, and the standalone swatch page (color-palette.html).
* [Design tokens (palette, typography, fonts)](tokens.md) - The site's visual language: dark plum-ground theme built from the four-pair site palette (lilac text, peach primary actions), Bona Nova serif body + Lavishly Yours script display, and the font licensing note (Bona Nova is a local trial TTF until swapped for woff2).
