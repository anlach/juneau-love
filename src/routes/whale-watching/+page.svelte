<script lang="ts">
	import { auth } from '#lib/session.svelte.ts';
	import StateScreen from '#lib/components/StateScreen.svelte';

	// Guest content: approval-gated like everything else
	// (knowledge/stories/whale-watch.md).
	const status = $derived(auth.kind === 'ready' ? auth.profile?.status ?? null : null);
	const name = $derived(auth.profile?.display_name ?? undefined);
</script>

<svelte:head>
	<title>Whale Watch — juneau.love</title>
</svelte:head>

{#if auth.kind === 'anonymous'}
	<div class="card center">
		<h2 class="display" style="font-size: 2rem">Sign in to continue</h2>
		<p class="sub">The whale watch details wait on the inside.</p>
		<div class="spread"><a class="btn" href="/login">Sign in</a></div>
	</div>
{:else if status === 'pending'}
	<StateScreen status="pending" name={name} />
{:else if status === 'rejected'}
	<StateScreen status="rejected" name={name} />
{:else if auth.kind === 'error'}
	<StateScreen status="error" message={auth.message} />
{:else}
	<div class="card">
		<p class="kicker">Friday, June 18, 2027 · the day before</p>
		<h2 class="display" style="font-size: 2rem">Whale Watch</h2>
		<ul class="plan">
			<li>
				<strong>2:45 PM — meet at Statter Harbor.</strong> Arrive by 2:45 so we can get
				everyone aboard and leave on time.
			</li>
			<li><strong>3:00 PM — departure.</strong> We head out promptly at 3.</li>
			<li>
				<strong>6:00 PM — back at Statter Harbor.</strong> We’ll be in port by 6.
			</li>
		</ul>
		<p>There’s room for up to 120 of us out there — plenty of space for the whole group.</p>
		<div class="spread">
			<a class="btn" href="/rsvp">RSVP</a>
		</div>
	</div>
{/if}

<style>
	.kicker {
		text-transform: uppercase;
		letter-spacing: 0.35em;
		font-size: 0.8rem;
		color: var(--glow);
		margin-bottom: 0.5rem;
	}
	.plan {
		margin: 0.5rem 0 1rem;
		padding-left: 1.3rem;
	}
	.plan li {
		margin: 0.45rem 0;
	}
</style>
