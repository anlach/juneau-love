# juneau-love

Wedding website. SvelteKit frontend, prerendered with `adapter-static` and deployed to GitHub Pages.

## Coming Up
Live updating photo slideshow. (The gallery itself is in: approved guests
see the shared photos and can upload JPEG/PNG/WebP up to 5 MB through the
`asset-upload-url` / `asset-url` edge functions and the private Hippius S3
bucket.)

## Development

```sh
npm run dev
```

## Build

```sh
npm run build     # static site in build/ (preview with `npm run preview`)
npm run check     # svelte-check
```

The site is served from the root of the custom domain (juneau.love), so
no base path is needed.

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

### Deploying edge functions

```sh
# Same one-time setup as above (CLI + link). Secrets first:
supabase secrets set RESEND_API_KEY=<key> EMAIL_FROM='juneau.love <notify@juneau.love>'
supabase secrets set S3_BUCKET=juneau-assets S3_ACCESS_KEY_ID=<hip_…> S3_SECRET_ACCESS_KEY=<key> SUPABASE_ANON_KEY=<anon key>

# Then deploy. send-login-link and notify-registration are the public
# functions (called with no JWT): --no-verify-jwt persists that setting.
supabase functions deploy send-login-link --no-verify-jwt
supabase functions deploy notify-registration --no-verify-jwt
supabase functions deploy registration-decision
supabase functions deploy asset-url
supabase functions deploy asset-upload-url
```

The S3 secrets are the Hippius credentials for the private `juneau-assets`
bucket — endpoint, signing quirks, and seeding are documented in
[knowledge/platform/project.md](knowledge/platform/project.md#assets-s3-hippius).
The presigner is validated by `deno run -A supabase/tests/s3-presign.ts`
(vectors always; live round-trip when `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_BUCKET` are in the environment).

### Client environment

Copy `.env.example` to `.env` and fill in `PUBLIC_SUPABASE_URL` /
`PUBLIC_SUPABASE_ANON_KEY` (dashboard → Project Settings → API). The site is
static, so these are baked in at build time and are public by design — never
put the service role key or the DB password in the client env. For local
development against the local stack, point `.env` at `http://127.0.0.1:54321`
(dev server origin must stay `http://localhost:3000`, matching
`site_url` in `supabase/config.toml`).

## E2E tests

Playwright suite in `e2e/` exercises the real flows end to end against the
local Supabase stack: sign-in link (eligibility, cooldown, one-shot
magic links), registration confirmation, the approval gate, the guest
gallery, and the admin approve/reject flow (asserting the RBAC role sync
in the DB). Auth links are minted out-of-band with GoTrue's admin
generate_link, standing in for the mail provider.

```sh
supabase start          # local stack, with seed data
npx playwright test     # builds the site with --mode test (.env.test),
                        # serves it on :4173, uses system Chromium
```

Tests run single-worker in file order (they share live Supabase state)
and clean up the users they create. `.env.test` is committed — it targets
the local stack's default JWT secret, so no local `.env` is needed for
e2e.

## Deploy (site)

Push to `main` — the GitHub Actions workflow in `.github/workflows/deploy.yml` builds the site
and deploys it to GitHub Pages.

One-time setup: set the repository variables `PUBLIC_SUPABASE_URL` and
`PUBLIC_SUPABASE_ANON_KEY` (Settings → Secrets and variables → Actions →
Variables → New repository variable) — the static build inlines them at
build time and fails without them (both are public by design; plain
variables, not secrets).

In the repo settings, set **Pages → Build and deployment → Source** to **GitHub Actions**.

The custom domain is declared in the `CNAME` file at the repo root; the old URL
`https://anlach.github.io/juneau-love` redirects to `https://juneau.love`.

## Knowledge

`knowledge/` holds the project's OKF (Open Knowledge Format) bundles:
`db` (Supabase schema, RLS), `api` (client API surface, auth), `design`
(ux/ui), and `stories` (user stories, business rules). Routing rules and
conventions live in `.agents/skills/juneau-knowledge/SKILL.md`.

## Notes

- Two display fonts: "Lavishly Yours" (script, via `@fontsource/lavishly-yours`
  imported in `src/routes/+layout.svelte`) and "Bona Nova" (serif body, local
  trial TTFs in `static/fonts/` — swap for woff2 subsets before production).
- The whole UI is client-rendered (SPA fallback `404.html`) except the public
  landing `/`, which is prerendered; no user-specific data ever renders
  server-side.
