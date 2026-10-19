<script lang="ts">
	import '@fontsource/lavishly-yours/latin.css';
	import '../app.css';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { auth, hasPermission, initAuth, signOut } from '#lib/session.svelte.ts';

	let { children } = $props();

	const status = $derived(auth.kind === 'ready' ? auth.profile?.status ?? null : null);
	const name = $derived(auth.profile?.display_name ?? undefined);

	onMount(() => initAuth());

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
			<a class="btn small" href="/register">Register</a>
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
