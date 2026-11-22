---
type: design-decision
title: Background tree silhouettes
description: "Three tree silhouettes from a linocut sheet sit behind the content in the bottom corners of every page (two left, one right). Each is a horizontal slice of a tree — right 60% for the left front tree, right 50% for the left back, left 48% for the right — with the bottom quarter cut away, so trunk bases are never on screen; each tree's color is a base control on the /theme page."
generated: { by: pi, at: 2026-11-22T22:56:41Z }
---

# Background tree silhouettes

Decorative trees in the bottom corners on **every page** (mounted once in the
root layout, so they come free to all routes). Background figures: `z-index: -1`
(above the page background, below all content), `pointer-events: none`,
`aria-hidden`.

## Source & files

Source artwork: a 12-tree linocut sheet (Inkscape SVG, `~/Downloads/trees.svg`).
The three chosen trees were extracted to `static/trees/`, one file per tree, in
the sheet's original coordinates with the original `transform` and **no fill**
(the color comes from the page):

| File | Sheet tree | Screen | Slice |
|---|---|---|---|
| `tree-left-front.svg` | the narrowest tree (tallest aspect) | left, in front | right 60% |
| `tree-left-back.svg` | the widest tree (shortest aspect) | left, behind | right 50% |
| `tree-right.svg` | a mid-width tree | right | left 48% |

Selection rule: on the left, a low-aspect-ratio (narrow/tall) tree sits in
front of a high-aspect-ratio (wide) tree; the right gets a different mid-width
silhouette.

## Cropping & the off-screen-bottom invariant

The crop is **not** in the static files — it is the `viewBox` of each inline
`<svg>` in `TreesBackground.svelte` (sheet coordinates):

- side-of-screen rule: the left front tree shows the tree's **right** 60%,
  the left back tree its **right** 50%, a tree at the right shows its
  **left** 48% — the straight cut edge always lands on the screen edge,
  never mid-screen;
- every slice stops at **75% of the tree's height**, so the trunk base is not
  in the image at all. The images are anchored `bottom: 0`, so no matter how
  they are resized (or by whom), the bottom of a tree can never be on screen.

`TreesBackground.svelte` (src/lib/components) holds three
`<svg><use href="/trees/<file>#tree"/></svg>` elements. Same-origin external
`<use>` + `fill` inherited into the shadow tree is how the theme colors them.

## Position, size, color

- Position/size: the CSS in `TreesBackground.svelte` (`left`/`right` + `height`
  per tree) — the intended place to nudge them.
- Layering: the left front tree paints above the left back one (`z-index: -2`
  on the back tree, inside the `z-index: -1` container).
- The cut edge's screen position *is* the tree's `left`/`right` offset: the crop
  fills its element exactly (width follows the viewBox aspect ratio), and the
  straight ink edge sits on the element's cut-side border. Keep the offset `0`
  (`left: 0` for the left trees, `right: 0` for the right tree) so the cut edge
  lands on the screen edge; any positive offset floats the cut line in from the
  edge.
- Color: three base controls — `--tree-left-back`, `--tree-left-front`,
  `--tree-right` ([Design tokens](/tokens.md)), shipped defaults in `app.css`,
  pickable in the **Trees** section of the [/theme page](/theme-customization.md).

## Swapping or re-slicing a tree

Regenerate a `static/trees/<file>` from the sheet (keep the `transform`, drop
the `style`/fill, set the file `viewBox` to the tree's content bbox), then edit
the matching inline `viewBox` (slice) and CSS (position/size). The sheet's
per-tree content bboxes were measured from rendered rasters, not path
parsing — the sheet's path data contains decoy geometry that misleads naive
bbox calculations.

## Depends on

- [Design tokens](/tokens.md) — the three tree colors are base controls.
- [Theme customization](/theme-customization.md) — Trees section.
- [Shared components](/components.md) — root-layout site chrome.
