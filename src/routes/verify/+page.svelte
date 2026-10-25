<script lang="ts">
	import { PUBLIC_SUPABASE_URL } from '$app/env/public';

	// Thin hop to the hosted GoTrue web endpoint. GoTrue builds email
	// links as `SiteURL + /verify?token=…&type=…&redirect_to=…` (its
	// default confirmation URL path), and `site_url` must stay
	// https://juneau.love — GoTrue silently rewrites any `redirect_to`
	// whose origin doesn't match `site_url` (knowledge/platform/
	// project.md), and the magic-link flow depends on that. So the link
	// lands here, and we pass the entire query string straight through
	// to the real verify endpoint. GoTrue confirms the email (or creates
	// the magic-link session) and redirects back to the referrer with the
	// session in the URL fragment; supabase-js's detectSessionInUrl
	// installs it, and /auth/confirm (or the root layout for a pending
	// user) takes over.
	$effect(() => {
		window.location.replace(`${PUBLIC_SUPABASE_URL}/auth/v1/verify${window.location.search}`);
	});
</script>

<svelte:head>
	<title>Verifying… — juneau.love</title>
</svelte:head>

<div class="card center">
	<h2 class="display" style="font-size: 2rem">Verifying…</h2>
	<p class="sub">One moment.</p>
</div>
