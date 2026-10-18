# Knowledge

OKF (Open Knowledge Format) bundles documenting the juneau-love site.
Each subdirectory is one bundle; the bundle root for OKF tooling is
`knowledge/<bundle>/`.

| Bundle | Contents |
|---|---|
| `db/` | PostgreSQL/Supabase: table schemas, access patterns, RLS policies |
| `api/` | Client API surface: PostgREST endpoints, auth flow, edge functions |
| `design/` | UX/UI: design tokens, components, design decisions, a11y |
| `stories/` | User stories, flows, acceptance criteria, business rules |
| `platform/` | Cross-cutting implementation notes: hosted Supabase project, env vars, deploy workflow |

Routing rules (what goes where), triggers, type vocabulary, and tooling
live in the repo skill: `.agents/skills/juneau-knowledge/SKILL.md`.
General OKF mechanics live in the global `okf` skill.

Run OKF checks **per bundle** (e.g. `knowledge/db`), not on `knowledge/`
itself — this file is not a concept.
