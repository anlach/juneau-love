---
type: design-token
title: Color palette
description: "The site's four primary/secondary color pairs (gold/lilac, sage/plum, terracotta/peach, slate/sand): hex values, the --color-* custom properties in app.css, tentative role assignments, and contrast limits."
status: stable
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-22T05:39:00Z }
verified: { by: human:anlach, at: 2026-10-18T10:18:13Z }
---

# Color palette

Four primary/secondary pairs that may be combined freely across areas of
the site. The hex values are settled by the human; the working names
(gold, lilac, …) are agent-assigned labels — rename them anywhere
(`app.css` + this doc) if better names come up.

## Pairs

| # | Primary | Secondary | Working names |
|---|---|---|---|
| 1 | `#a7923c` | `#c7c5cc` | gold / lilac |
| 2 | `#a3c5ac` | `#311b29` | sage / plum |
| 3 | `#c9692f` | `#e3ab84` | terracotta / peach |
| 4 | `#54697a` | `#e1bfa4` | slate / sand |

## CSS custom properties

Declared once in `:root` in `src/app.css` so every component shares
them: `--color-gold`, `--color-lilac`, `--color-sage`, `--color-plum`,
`--color-terracotta`, `--color-peach`, `--color-slate`, `--color-sand`.
Components must not hardcode palette hex values.

## Tentative usage

Tentative assignments — not locked:

| Token | Where | Why |
|---|---|---|
| lilac | page background | lightest neutral; plum text on it is 9.3:1 |
| plum | all text, focus outlines | the only token that clears 4.5:1 body text on lilac |
| gold | decorative accents (dividers, sparks) | decorative (1.8:1 on lilac) |
| peach | primary button background | plum text on peach is 7.9:1 |
| sand | button hover background | plum text on sand is 9.2:1 |
| sage | text selection highlight, disabled states | plum on sage is 8.4:1 |
| terracotta | spare accent | 2.2:1 on lilac: decorative only |
| slate | spare accent | 3.3:1 on lilac: large text/decoration only |

## Contrast limits (WCAG)

| Foreground on background | Ratio | Usable for |
|---|---|---|
| plum on lilac | 9.3:1 | body text |
| plum on peach | 7.9:1 | button text |
| plum on sand | 9.2:1 | button hover text |
| plum on sage | 8.4:1 | chips, disabled text |
| terracotta on white (reference) | 3.8:1 | large text only |
| slate on lilac | 3.3:1 | large text / decoration |
| gold on lilac | 1.8:1 | decoration only |
