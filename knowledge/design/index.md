# component

* [Shared components and conventions](components.md) - The class-based component kit in src/app.css (frame/header/nav, card, buttons, fields, messages, badges, table, gallery grid) plus the StateScreen component for the signed-in status screens.

# design-decision

* [What renders where (prerendered vs client-rendered)](prerender.md) - Only the public landing / is prerendered; every session- or status-dependent route is client-rendered behind the adapter-static SPA fallback (404.html), so no user-specific data ever reaches prerendered HTML.

# design-token

* [Design tokens (palette, typography, fonts)](tokens.md) - The site's visual language: warm cream/ink/rose palette, Bona Nova serif body + Lavishly Yours script display, and the font licensing note (Bona Nova is a local trial TTF until swapped for woff2).
