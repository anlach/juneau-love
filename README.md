# juneau-love

Wedding website. SvelteKit frontend, prerendered with `adapter-static` and deployed to GitHub Pages.

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

## Deploy

Push to `main` — the GitHub Actions workflow in `.github/workflows/deploy.yml` builds the site
and deploys it to GitHub Pages.

In the repo settings, set **Pages → Build and deployment → Source** to **GitHub Actions**.

The custom domain is declared in the `CNAME` file at the repo root; the old URL
`https://anlach.github.io/juneau-love` redirects to `https://juneau.love`.

## Notes

- The "Lavishly Yours" font is bundled via `@fontsource/lavishly-yours` (imported in
  `src/routes/+layout.svelte`), so the site has no external font dependency.
- The RSVP section is a placeholder; wire it up to a backend later.
