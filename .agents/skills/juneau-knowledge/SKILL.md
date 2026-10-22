---
name: juneau-knowledge
description: >
  Read, create, and maintain the OKF knowledge bundles for this repo
  (knowledge/db, knowledge/api, knowledge/design, knowledge/stories,
  knowledge/platform): Supabase table schemas and RLS, the client API
  surface and auth flow, UX/UI decisions, user stories with business
  rules, and cross-cutting project notes. Use when answering questions
  about the db schema, data access, API endpoints, auth, design, or user
  flows in this repo, and after any change that touches schema, API
  calls, UI, or business logic.
---

# juneau-love knowledge

This skill extends the global `okf` skill (read it first for mechanics:
frontmatter rules, links, extraction discipline, trust tiers, tooling).
It carries only what is specific to this repo: the bundle map, triggers,
and the type vocabulary.

## What the bundles are

The bundles are the **design** of the site — what will actually exist.
They are not an implementation tracker:

- Do not record what is or isn't shipped, "planned vs implemented", or
  other implementation state. No `status` field for that purpose.
- Do not keep historical versions of dropped designs. When a design is
  dropped, delete or rewrite the concepts that carry it — a table that
  no longer exists gets no concept, and no "this was replaced by"
  history sections (git is the history).
- One fact lives in **one** concept; everywhere else it is a link. If
  two concepts need the same rule, one keeps the rule and the other
  links to it.

## Architecture (settled)

Static SvelteKit site (`adapter-static`) on GitHub Pages, talking
directly to Supabase from the browser:

- `supabase-js` in the client with the **anon** key; **RLS is the
  security boundary** (client-side route gating is UX, not security). An
  unauthenticated session sees zero rows; prerendered HTML is fetchable
  by URL, so never bake sensitive data into it.
- **Passwordless, two-gate auth** (email confirmation, then admin
  approval) with native GoTrue magiclinks and **no login edge function**
  — [Client authentication](../../knowledge/api/client-auth.md).
- Two edge functions hold the **service role** key — anything privileged
  or email-sending goes through one of them:
  [send-login-link](../../knowledge/api/send-login-link.md) (public) and
  [registration-decision](../../knowledge/api/registration-decision.md)
  (admin).
- Guest content is gated on approval status ([Access by approval
  status](../../knowledge/stories/access-by-approval-status.md)); admin
  capabilities on RBAC permissions ([RBAC](../../knowledge/db/rbac.md)).

## Bundle map (what goes where)

Bundle root for OKF tooling is `knowledge/<bundle>/`.

| Bundle | Contents |
|---|---|
| `knowledge/db/` | One concept per table — or per tightly-coupled table group, like the [RBAC catalog](../../knowledge/db/rbac.md): schema, data access patterns, RLS policies. Index/constraint choices, triggers, and notes that affect a table go in that table's concept. Supabase's managed `auth.*` schema is referenced where relevant, never given its own concepts. |
| `knowledge/api/` | The client-facing API surface: PostgREST operations the frontend performs (with filters/ordering/error expectations), the auth flow, and edge functions. |
| `knowledge/design/` | UX/UI: design tokens, component conventions, page-level design decisions, accessibility. |
| `knowledge/stories/` | User stories: user-facing flows, acceptance criteria, and **business rules** (deadlines, limits, edge cases). Business logic lives here, next to the flow it governs. |
| `knowledge/platform/` | Cross-cutting project notes: the hosted Supabase project, required dashboard settings, secrets handling, bootstrap. |

## Type vocabulary

Pick from these; add new values only when none fits, and keep them
self-explanatory.

| Bundle | Types |
|---|---|
| `db` | `db-table` (single table), `db-schema` (a tightly-coupled group of tables/views) |
| `api` | `api-endpoint`, `auth-flow`, `edge-function` |
| `design` | `design-token`, `component`, `design-decision` |
| `stories` | `user-story` |
| `platform` | `project-notes` |

`db-table` and `db-schema` concepts use the body headings `# Schema`,
`# Access patterns`, `# RLS` (in that order).

## Upkeep triggers

Update knowledge **in the same commit** as the change it documents:

- Schema change or migration → update the affected `db` concept
  (including its `# RLS` section when policies change).
- New or changed client API call (supabase query, endpoint, edge
  function) → add/update the matching `api` concept.
- Auth flow change (providers, session handling, redirect URLs) → update
  the `auth-flow` concept.
- UI decision (new component, token, layout, a11y) → add/update a
  `design` concept.
- New flow, requirement, or business rule → add/update a `user-story`;
  cross-link the `db`/`api` concepts it depends on.
- Dropped design → delete or rewrite the concepts that carried it (see
  "What the bundles are" above).

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
extraction rules (stale = re-verify, unverified = check sources). If a
bundle is still empty, say so rather than re-deriving from code
silently — and offer to write the missing concept.
