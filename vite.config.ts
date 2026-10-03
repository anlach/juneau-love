import process from 'node:process';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// GitHub Pages: prerender the whole site as static files.
			// The 404 fallback replaces GitHub Pages' default 404 page.
			adapter: adapter({
				fallback: '404.html'
			}),

			// In production the site is served from the root of the custom domain
			// (juneau.love), so no base path is needed. Set BASE_PATH only if you revert
			// to the anlach.github.io/juneau-love subpath (without a custom domain), e.g.:
			//   BASE_PATH=/juneau-love npm run build
			paths: {
				base: (process.argv.includes('dev') ? '' : (process.env.BASE_PATH ?? '')) as
					| ''
					| `/${string}`
			}
		})
	]
});
