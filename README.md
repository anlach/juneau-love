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

# GitHub Pages-style build (base path /juneau-love)
BASE_PATH=/juneau-love npm run build
```

## Deploy

Push to `main` — the GitHub Actions workflow in `.github/workflows/deploy.yml` builds the site
(with `BASE_PATH=/juneau-love`) and deploys it to GitHub Pages.

In the repo settings, set **Pages → Build and deployment → Source** to **GitHub Actions**.

## Notes

- The "Lavishly Yours" font is bundled via `@fontsource/lavishly-yours` (imported in
  `src/routes/+layout.svelte`), so the site has no external font dependency.
- The RSVP section is a placeholder; wire it up to a backend later.
