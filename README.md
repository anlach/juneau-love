# juneau-love

Wedding website. SvelteKit frontend, prerendered with `adapter-static` and deployed to GitHub Pages.

## Coming Up
Live updating photo slideshow and photo upload / gallery

## Development

```sh
npm run dev
```

## Build

```sh
# Local preview (base path /)
npm run build

# Production build. The site is served from the root of the custom domain
# (juneau.love), so no base path is needed.
npm run build
```

## Supabase

The database, auth, and (later) edge functions live in Supabase. All schema
changes are migrations under `supabase/migrations/`; the schema documentation
is the `knowledge/db` bundle (one concept per table). The hosted project is
`asuupanisvfxvbmdpcxt` (us-west-2).

### Local development

```sh
supabase start     # local stack (Docker); applies migrations + seed.sql
supabase db reset  # re-apply migrations + seed from scratch
```

`supabase/seed.sql` is local-only dev data (a local admin / guest / pending
user) and is never applied to the hosted project.

### Deploying migrations to the hosted project

One-time setup:

```sh
# Install the CLI
mise use -g supabase-cli/supabase

# Link this repo to the hosted project. SUPABASE_ACCESS_TOKEN is the
# Management API personal access token ($SUPABASE_ACCESS_KEY in your env);
# never commit it.
export SUPABASE_ACCESS_TOKEN="$SUPABASE_ACCESS_KEY"
supabase link --project-ref asuupanisvfxvbmdpcxt
```

Every deploy (migrations are applied in filename order and tracked in
`supabase_migrations.schema_migrations`, so only new files run):

```sh
# DB password: dashboard → Project Settings → Database. `db push`
# connects to the hosted database directly as postgres.
export SUPABASE_DB_PASSWORD='<postgres password>'
supabase db push        # apply new migrations
supabase db advisors    # RLS / schema health check
```

To add a migration: `supabase migration new <name>`, edit the generated
file, and update `knowledge/db` in the same commit. This project does **not**
auto-expose new tables to the Data API, so migrations must include explicit
`GRANT`s (the initial migration shows the pattern). Do not run
`supabase db reset --linked` — it drops user data.

The first admin is bootstrapped out-of-band (dashboard → Auth → Users → Add
user, approve the row, insert the admin role in the SQL editor) — see
[knowledge/db/users.md](knowledge/db/users.md#access-patterns).

### Client environment

Copy `.env.example` to `.env` and fill in `PUBLIC_SUPABASE_URL` /
`PUBLIC_SUPABASE_ANON_KEY` (dashboard → Project Settings → API). The site is
static, so these are baked in at build time and are public by design — never
put the service role key or the DB password in the client env.

## Deploy (site)

Push to `main` — the GitHub Actions workflow in `.github/workflows/deploy.yml` builds the site
and deploys it to GitHub Pages.

In the repo settings, set **Pages → Build and deployment → Source** to **GitHub Actions**.

The custom domain is declared in the `CNAME` file at the repo root; the old URL
`https://anlach.github.io/juneau-love` redirects to `https://juneau.love`.

## Knowledge

`knowledge/` holds the project's OKF (Open Knowledge Format) bundles:
`db` (Supabase schema, RLS), `api` (client API surface, auth), `design`
(ux/ui), and `stories` (user stories, business rules). Routing rules and
conventions live in `.agents/skills/juneau-knowledge/SKILL.md`.

## Notes

- The "Lavishly Yours" font is bundled via `@fontsource/lavishly-yours` (imported in
  `src/routes/+layout.svelte`), so the site has no external font dependency.
- The RSVP section is a placeholder; wire it up to a backend later.
