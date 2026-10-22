import { defineEnvVars } from '@sveltejs/kit/env';

/**
 * Explicit env vars (SvelteKit 3). Values come from `.env` / `.env.test`;
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
