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

**Automated:** a push to main runs
[.github/workflows/deploy-supabase.yml](.github/workflows/deploy-supabase.yml),
which applies pending migrations and redeploys all edge functions
(`workflow_dispatch` re-runs it on demand). The commands below are the
manual fallback — the same steps, run locally.

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

Manual fallback (the workflow does exactly this; migrations are applied in
filename order and tracked in `supabase_migrations.schema_migrations`, so
only new files run):

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

**Automated:** the same workflow (push to main) deploys all six functions,
every time (idempotent). Manual fallback (same one-time setup as above —
CLI + link): secrets first, then deploy:

```sh
supabase secrets set MAIL_RELAY_URL='https://mail.juneau.love' MAIL_RELAY_TOKEN='<token>'
supabase secrets set S3_BUCKET=juneau-assets S3_ACCESS_KEY_ID=<hip_…> S3_SECRET_ACCESS_KEY=<key> SUPABASE_ANON_KEY=<anon key>

# Then deploy. send-login-link and notify-registration are the public
# functions (called with no JWT): --no-verify-jwt persists that setting.
supabase functions deploy send-login-link --no-verify-jwt
supabase functions deploy notify-registration --no-verify-jwt
supabase functions deploy registration-decision
supabase functions deploy asset-url
supabase functions deploy asset-upload-url
supabase functions deploy asset-delete
```

The S3 secrets are the Hippius credentials for the private `juneau-assets`
bucket — endpoint, signing quirks, and seeding are documented in
[knowledge/platform/project.md](knowledge/platform/project.md#assets-s3-hippius).
The presigner is validated by `deno run -A supabase/tests/s3-presign.ts`
(vectors always; live round-trip when `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_BUCKET` are in the environment).

### Mail (self-hosted Maddy)

There is no third-party email provider. Login links, the new-registration
admin alert, and Supabase's own auth emails (confirmation, signup) are sent
from a VPS running **Maddy**. Edge functions can't open raw TCP (the edge
runtime denies `Deno.connect`), so they POST to a small HTTP→SMTP **relay**
on the VPS (Caddy fronts it with TLS), which hands off to Maddy over
loopback; GoTrue connects to Maddy's `:587` submission port directly
(Supabase custom SMTP, applied via the Management API).

The full VPS install — Maddy, relay, Caddy, DNS (SPF/DKIM/DMARC/PTR),
DKIM key publishing, the Supabase SMTP call — is
[`infra/mail/README.md`](infra/mail/README.md); the design notes are in
[knowledge/platform/mail.md](knowledge/platform/mail.md). The relay token is
the one value shared between the VPS (`/etc/mail-relay/env`) and Supabase
(`MAIL_RELAY_TOKEN` secret). Locally there is no relay: without
`MAIL_RELAY_URL`/`MAIL_RELAY_TOKEN` the functions print emails to their log
and count them as sent.

### Client environment

The site is static, so `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY`
are inlined into the JS bundle at build time (`src/env.ts`). Both values
are public by design — every visitor's browser receives them, and Postgres
RLS is the security boundary — so each environment's values live in a
committed Vite env file and there is **nothing to configure in GitHub
Actions**:

| File | Mode | Points at | Used by |
|---|---|---|---|
| `.env.development` | development | local stack | `npm run dev` |
| `.env.test` | test | local stack | `npx playwright test` |
| `.env.production` | production | hosted project | `npm run build` (local and CI) |

A gitignored local `.env` can still override for one-off experiments
(Vite precedence: `.env` < `.env.local` < `.env.<mode>` <
`.env.<mode>.local`). Never put the service role key, the DB password, or
any Management API credential in a client env file. For local development
the dev server origin must stay `http://localhost:3000`, matching
`site_url` in `supabase/config.toml`.

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
and deploys it to GitHub Pages. Build-time env comes from the committed
`.env.production` (see [Client environment](#client-environment)) — no
repository variables or secrets are needed.

In the repo settings, set **Pages → Build and deployment → Source** to **GitHub Actions**.

The custom domain is declared in the `CNAME` file at the repo root; the old URL
`https://anlach.github.io/juneau-love` redirects to `https://juneau.love`.

## Knowledge

`knowledge/` holds the project's OKF (Open Knowledge Format) bundles:
`db` (Supabase schema, RLS), `api` (client API surface, auth), `design`
(ux/ui), `stories` (user stories, business rules), and `platform` (hosted
Supabase project, secrets, the self-hosted mail stack). Routing rules and
conventions live in `.agents/skills/juneau-knowledge/SKILL.md`.

## Notes

- Two display fonts: "Lavishly Yours" (script, via `@fontsource/lavishly-yours`
  imported in `src/routes/+layout.svelte`) and "Bona Nova" (serif body, local
  trial TTFs in `static/fonts/` — swap for woff2 subsets before production).
- The whole UI is client-rendered (SPA fallback `404.html`) except the public
  landing `/`, which is prerendered; no user-specific data ever renders
  server-side.
