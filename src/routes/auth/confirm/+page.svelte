<script lang="ts">
	import { goto } from '$app/navigation';
	import { auth } from '#lib/session.svelte.ts';

	// The email-confirmation link pointed GoTrue's verify endpoint at this
	// route; the session arrived in the URL fragment and supabase-js
	// installed it (email now confirmed, status still 'pending'). The root
	// layout routes a pending, signed-in user to the awaiting-approval
	// screen, so we simply send them home.
	$effect(() => {
		if (auth.kind === 'ready' || auth.kind === 'error') void goto('/', { replaceState: true });
	});
</script>

<svelte:head>
	<title>Confirming… — juneau.love</title>
</svelte:head>

<div class="card center">
	{#if auth.kind === 'loading'}
		<h2 class="display" style="font-size: 2rem">Confirming…</h2>
		<p class="sub">One moment.</p>
	{:else if auth.linkError}
		<h2 class="display" style="font-size: 2rem">That link didn’t work</h2>
		<p class="msg err">{auth.linkError}</p>
		<div class="spread">
			<a class="btn" href="/">Back home</a>
		</div>
	{:else}
		<h2 class="display" style="font-size: 2rem">You’re in — almost</h2>
		<p class="sub">We’ve confirmed your email. Taking you to your invitation…</p>
	{/if}
</div>
