import { defineConfig } from '@playwright/test';

/**
 * E2E harness for the Juneau static site against the local Supabase stack.
 *
 * - Serves the production static build via `vite preview` (so deep links use
 *   the adapter-static SPA fallback, exactly like GitHub Pages).
 * - Uses the system Chromium (no bundled browser download).
 * - Talks to the local Supabase on 127.0.0.1:54321 (anon key is baked into
 *   the build via .env). Auth links are produced out-of-band with GoTrue's
 *   admin `generate_link`, which stands in for the mail provider locally.
 *
 * Run the local stack first: `supabase start`.
 */
export default defineConfig({
	testDir: './e2e',
	// Tests share live Supabase state (users/roles), so run them in a single
	// worker, in file order, with no parallelism.
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 60_000,
	expect: { timeout: 10_000 },
	reporter: [['list']],
	outputDir: 'test-results',
	use: {
		baseURL: 'http://localhost:4173',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		launchOptions: {
			executablePath: '/usr/bin/chromium',
			args: ['--no-sandbox', '--disable-dev-shm-usage']
		}
	},
	webServer: {
		// --mode test makes the build load the committed .env.test (local-stack
		// URL + anon key), so e2e is reproducible without a local .env.
		command: 'npm run build -- --mode test && npx vite preview --port 4173 --strictPort',
		url: 'http://localhost:4173',
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
		stdio: 'ignore'
	}
});
