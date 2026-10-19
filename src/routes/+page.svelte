<script lang="ts">
	import { auth, hasPermission } from '#lib/session.svelte.ts';
	import StateScreen from '#lib/components/StateScreen.svelte';

	// Safe, reactive views over the (nullable) profile — TS can't narrow
	// `auth.profile` from `auth.kind`, so we derive the fields we display.
	const profile = $derived(auth.profile);
	const status = $derived(auth.kind === 'ready' ? profile?.status ?? null : null);
	const name = $derived(profile?.display_name ?? undefined);
</script>

<svelte:head>
	<title>juneau.love — you're invited</title>
</svelte:head>

{#if status === 'approved'}
	<div class="card center">
		<h2 class="display" style="font-size: 2.2rem">Welcome, {name}</h2>
		<p>You're all set — your invitation is inside.</p>
		<div class="spread">
			<a class="btn" href="/gallery">See the photos</a>
			{#if hasPermission('registrations:read')}
				<a class="btn ghost" href="/registrations">Review registrations</a>
			{/if}
		</div>
	</div>
{:else if status === 'pending'}
	<StateScreen status="pending" name={name} />
{:else if status === 'rejected'}
	<StateScreen status="rejected" name={name} />
{:else if auth.kind === 'error'}
	<StateScreen status="error" message={auth.message} />
{:else}
	<!-- anonymous (and during the initial client-side check): public invitation -->
	<section class="hero center">
		<p class="kicker">juneau &amp; riley</p>
		<h1 class="display" style="font-size: 4.5rem; margin: 0.2rem 0">You're invited</h1>
		<p class="sub" style="max-width: 34ch; margin: 0 auto">
			This is a private corner of the internet for our wedding — register with your email
			and we'll let you in.
		</p>
		<div class="spread">
			<a class="btn" href="/register">Register</a>
			<a class="btn ghost" href="/login">I have an account</a>
		</div>
	</section>
{/if}

<style>
	.hero {
		padding: 4rem 0 2rem;
	}
	.kicker {
		text-transform: uppercase;
		letter-spacing: 0.35em;
		font-size: 0.8rem;
		color: var(--rose);
		margin-bottom: 0.5rem;
	}
	.sub {
		color: var(--muted);
	}
</style>
