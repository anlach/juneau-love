import { defineEnvVars } from '@sveltejs/kit/env';

/**
 * Explicit env vars (SvelteKit 3). Values come from the committed
 * per-mode files — `.env.development` / `.env.test` (local stack) and
 * `.env.production` (hosted) — or a gitignored local `.env` override;
 * `static: true` inlines them into the client bundle at build time, which
 * is what a fully static (adapter-static) site needs.
 */
export const variables = defineEnvVars({
	PUBLIC_SUPABASE_URL: {
		public: true,
		static: true,
		description: 'Base URL of the Supabase project (local stack in dev/test, hosted in prod).'
	},
	PUBLIC_SUPABASE_ANON_KEY: {
		public: true,
		static: true,
		description: 'Public anon key. Safe in the browser bundle — Postgres RLS is the boundary.'
	}
});
