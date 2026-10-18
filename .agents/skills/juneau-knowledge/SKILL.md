---
name: juneau-knowledge
description: >
  Read, create, and maintain the OKF knowledge bundles for this repo
  (knowledge/db, knowledge/api, knowledge/design, knowledge/stories):
  Supabase table schemas and RLS, the client API surface and auth flow,
  UX/UI decisions, and user stories with business rules. Use when
  answering questions about the db schema, data access, API endpoints,
  auth, design, or user flows in this repo, and after any code change
  that touches schema, API calls, UI, or business logic.
---

# juneau-love knowledge

This skill extends the global `okf` skill (read it first for mechanics:
frontmatter rules, links, extraction discipline, trust tiers, tooling).
It carries only what is specific to this repo: the bundle map, triggers,
and the type vocabulary.

## Architecture (settled)

Static SvelteKit site (`adapter-static`) on GitHub Pages, talking
directly to Supabase from the browser ("Option A"):

- `supabase-js` in the client with the **anon** key; RLS is the security
  boundary. An unauthenticated session sees zero rows.
- **Passwordless auth, two gates.** Users have no passwords. Registration
  is client-side `auth.signUp` (email + display name) and creates a
  `pending` registration via DB trigger; the Supabase **email-confirmation
  link must be clicked first** (establishes the initial session). Only
  after admin approval does the guest get a **passcode link in an email**:
  a random passcode, valid 7 days and reusable on any device, redeemed by
  the public edge function `login-with-passcode` for a real Supabase
  session (1-day access token, 1-year refresh token, per project
  settings); supabase-js then auto-refreshes and persists the session in
  localStorage (NOT cookies — static site; NOT the `@supabase/ssr` cookie
  hooks, which need a server at runtime). Initial login is two steps:
  confirm email, then click the login link. "Sign in" anywhere means "email
  me a link" (`send-login-link`).
- Auth-protected routes (e.g. an admin area) are gated **client-side**
  (layout checks the session and redirects — this is UX). RLS enforces
  access for real. Prerendered HTML is fetchable by URL, so never bake
  sensitive data into prerendered output.
- The **service role** key lives only in Supabase edge functions
  (`login-with-passcode`, `send-login-link`, `registration-decision`).
  Anything privileged or email-sending goes through an edge function; the
  `login_passcodes` table is service-role-only (no client read).

## Bundle map (what goes where)

Bundle root for OKF tooling is `knowledge/<bundle>/`.

| Bundle | Contents |
|---|---|
| `knowledge/db/` | One concept per table: schema, data access patterns, RLS policies. Index/constraint choices, triggers, and migration notes that affect a table go in that table's concept. Supabase's managed `auth.*` schema is referenced where relevant, never given its own concepts. |
| `knowledge/api/` | The client-facing API surface: PostgREST operations the frontend performs (with filters/ordering/error expectations), the auth flow, and edge functions. |
| `knowledge/design/` | UX/UI: design tokens, component conventions, page-level design decisions, accessibility. |
| `knowledge/stories/` | User stories: user-facing flows, acceptance criteria, and **business rules** (deadlines, limits, edge cases). Business logic lives here, next to the flow it governs. |
| `knowledge/platform/` | Cross-cutting implementation notes: the hosted Supabase project, env vars, deploy workflow, secrets handling. |

Cross-cutting implementation notes (Supabase project setup, env vars,
deploy) go in the `knowledge/platform/` bundle.

## Type vocabulary

Pick from these; add new values only when none fits, and keep them
self-explanatory.

| Bundle | Types |
|---|---|
| `db` | `db-table` |
| `api` | `api-endpoint`, `auth-flow`, `edge-function` |
| `design` | `design-token`, `component`, `design-decision` |
| `stories` | `user-story` |
| `platform` | `deploy-notes` |

`db-table` concepts use the body headings `# Schema`, `# Access
patterns`, `# RLS` (in that order).

## Upkeep triggers

Update knowledge **in the same commit** as the code change it documents:

- Schema change or migration → update the affected `db-table` concept
  (including its `# RLS` section when policies change).
- New or changed client API call (supabase query, endpoint, edge
  function) → add/update the matching `api` concept.
- Auth flow change (providers, session handling, redirect URLs) →
  update the `auth-flow` concept.
- UI decision (new component, token, layout, a11y) → add/update a
  `design` concept.
- New flow, requirement, or business rule → add/update a `user-story`;
  cross-link the `db`/`api` concepts it depends on.

Status discipline: `status: draft` for anything planned but not yet
implemented; `status: stable` once the code ships. Never document
unimplemented behavior as current.

After editing: run `check` and `index` **per bundle** (the placeholder
root indexes are meant to be overwritten by `index`), then commit:

```
OKF=~/Projects/open-knowledge-format
TOOL=~/.pi/agent/skills/okf/scripts/okf.py
for b in db api design stories platform; do
  $OKF/.venv/bin/python $TOOL check knowledge/$b
  $OKF/.venv/bin/python $TOOL index knowledge/$b
done
```

## Extraction

When asked how something works, which columns exist, what a rule says,
or what was decided: read `knowledge/<bundle>/index.md` first, descend
as needed, and open only the concepts required. Apply the global okf
extraction rules (draft = caution, stale = re-verify, unverified =
check sources). If a bundle is still empty, say so rather than
re-deriving from code silently — and offer to write the missing concept.
