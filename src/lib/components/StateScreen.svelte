<script lang="ts">
	import { refreshState } from '#lib/session.svelte.ts';

	/**
	 * Shared status screens for signed-in guests (see
	 * knowledge/stories/access-by-approval-status.md):
	 *  - pending:  confirmed, waiting for approval — "Check status" re-reads
	 *              the approval state (the session already works; only the
	 *              content is gated)
	 *  - rejected: registration declined
	 *  - error:    profile could not be loaded
	 */
	let { status, name, message }: {
		status: 'pending' | 'rejected' | 'error';
		name?: string | null;
		message?: string | null;
	} = $props();

	let checking = $state(false);

	async function checkStatus() {
		checking = true;
		try {
			await refreshState();
		} finally {
			checking = false;
		}
	}
</script>

{#if status === 'pending'}
	<div class="card center">
		<h2 class="display" style="font-size: 2rem">
			{#if name}Hi {name}!{/if}
		</h2>
		<p>You’re on the list — your registration is just waiting for a final check.</p>
		<p class="sub">
			Once you’re approved you’ll get an email with a sign-in link, and this page will turn
			into your invitation.
		</p>
		<div class="spread">
			<button class="btn ghost" disabled={checking} onclick={checkStatus}>
				{checking ? 'Checking…' : 'Check status'}
			</button>
		</div>
	</div>
{:else if status === 'rejected'}
	<div class="card center">
		<h2 class="display" style="font-size: 2rem">We’re sorry{#if name}, {name}{/if}</h2>
		<p>Your registration hasn’t been approved this time, so there’s nothing to show here.</p>
		<p class="sub">If you think that’s a mistake, please reach out to the hosts.</p>
	</div>
{:else}
	<div class="card center">
		<h2 class="display" style="font-size: 2rem">Something went wrong</h2>
		<p>{message ?? 'We could not load your account. Please try again.'}</p>
		<div class="spread">
			<button class="btn ghost" onclick={checkStatus}>Try again</button>
		</div>
	</div>
{/if}
