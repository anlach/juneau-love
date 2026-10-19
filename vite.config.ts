import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			// Static site for GitHub Pages: the public landing (`/`) is
			// prerendered; every session/state-dependent route is
			// client-rendered and served through the SPA fallback. Served
			// from the root of juneau.love, so no base path.
			adapter: adapter({
				fallback: '404.html'
			})
		})
	],
	server: {
		// Keep the dev origin in sync with site_url in supabase/config.toml:
		// auth links redirect to {origin}/auth/confirm and {origin}/login, so a
		// dev origin that isn't reachable the same way would break local sign-in.
		port: 3000
	}
});
