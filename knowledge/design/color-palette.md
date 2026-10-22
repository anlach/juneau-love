---
type: design-token
title: Color palette
description: "The site's four primary/secondary color pairs (gold/lilac, sage/plum, terracotta/peach, slate/sand): hex values, the --color-* custom properties in app.css, tentative role assignments, and contrast limits."
status: stable
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-22T20:15:00Z }
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

Tentative assignments for the current dark (plum-ground) theme — not
locked:

| Token | Where | Why |
|---|---|---|
| plum | page + input background, primary button text | dark ground; lilac on plum is 9.3:1, plum on peach is 7.9:1 |
| lilac | body text; muted text is a 75/25 lilac/plum mix; soft borders | body 9.3:1 on plum; muted 5.9:1 on plum, 4.5:1 on card |
| peach | primary button background, links | 7.9:1 both directions against plum/peach |
| sand | button hover background, pending/rejected badge text | plum on sand is 9.2:1 |
| sage | success text (`.msg.ok`), approved badge | sage on plum is 8.4:1 |
| gold | decorative accents: card borders, focus outlines, kicker, selection background | 5.2:1 on plum — clears 3:1 for UI components |
| terracotta | destructive/error accent (mixed 35/65 with peach for readable `--error`); danger borders | raw 4.2:1 on plum; error mix is 6.4:1 |
| slate | input borders, pending badge tint | 2.8:1 on plum: tint/border only, no text |

## Contrast limits (WCAG)

| Foreground on background | Ratio | Usable for |
|---|---|---|
| lilac on plum | 9.3:1 | body text |
| lilac on card (plum 88% / lilac 12%) | 7.2:1 | text on elevated surfaces |
| muted (lilac 75% / plum 25%) on plum | 5.9:1 | secondary text |
| muted on card | 4.5:1 | secondary text on elevated surfaces |
| plum on peach | 7.9:1 | button text |
| plum on sand | 9.2:1 | button hover text |
| sage on plum | 8.4:1 | success, approved badge |
| peach on plum | 7.9:1 | links |
| gold on plum | 5.2:1 | focus, kicker, decoration |
| error mix (terracotta 35% / peach 65%) on plum | 6.4:1 | error text |
| slate on plum | 2.8:1 | tint / borders only |
