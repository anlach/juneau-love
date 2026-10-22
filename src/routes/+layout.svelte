<script lang="ts">
	import '@fontsource/lavishly-yours/latin.css';
	import '../app.css';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { supabase } from '#lib/supabase';
	import { auth, hasPermission, initAuth, signOut } from '#lib/session.svelte.ts';

	let { children } = $props();

	const status = $derived(auth.kind === 'ready' ? auth.profile?.status ?? null : null);
	const name = $derived(auth.profile?.display_name ?? undefined);

	onMount(() => initAuth());

	// Admin-notification fallback (knowledge/api/notify-registration.md):
	// the register page fires notify-registration right after signup; this
	// covers the case where that call never went through (tab closed) — the
	// guest's first visit after confirming their email lands here on the
	// awaiting-approval screen. The function is idempotent (the
	// users.admin_notified_at stamp), so re-firing is a cheap no-op, and a
	// failed send isn't stamped, so the next "check status" refresh
	// (a fresh profile object) retries it.
	$effect(() => {
		const profile = auth.profile;
		if (auth.kind !== 'ready' || !profile || profile.status !== 'pending' || profile.admin_notified_at) {
			return;
		}
		void supabase
			.functions.invoke('notify-registration', { body: { email: profile.email } })
			.then(({ error }) => {
				if (error) console.warn('notify-registration fallback failed:', error);
			});
	});

	async function onSignOut() {
		await signOut();
		await goto('/');
	}
</script>

<svelte:head>
	<link
		rel="icon"
		href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E💍%3C/text%3E%3C/svg%3E"
	/>
</svelte:head>

<header class="site-header frame">
	<a class="brand display" href="/">juneau<span class="dot">.</span>love</a>
	<nav class="site-nav">
		{#if auth.kind === 'anonymous'}
			<a href="/login">Sign in</a>
			<a href="/register">Register</a>
		{:else if auth.kind === 'ready'}
			{#if status === 'approved'}
				<a href="/gallery">Photos</a>
			{/if}
			{#if hasPermission('registrations:read')}
				<a href="/registrations">Registrations</a>
			{/if}
			<span class="who">{name}</span>
			<button class="btn small ghost" onclick={onSignOut}>Sign out</button>
		{/if}
	</nav>
</header>

<main class="frame">
	{@render children()}
</main>
