<script lang="ts">
	import { supabase } from '#lib/supabase';
	import { auth, refreshState } from '#lib/session.svelte.ts';
	import StateScreen from '#lib/components/StateScreen.svelte';

	// A party is at most eight people; the DB CHECK is the backstop for
	// hand-crafted writes (knowledge/db/users.md).
	const PARTY_MAX = 8;

	let count = $state<number | ''>('');
	let seeded = $state(false);
	let busy = $state(false);
	let formError = $state<string | null>(null);
	let saved = $state(false);

	// Safe, reactive views over the (nullable) profile — TS can't narrow
	// `auth.profile` from `auth.kind`, so we derive the fields we display.
	const profile = $derived(auth.profile);
	const status = $derived(auth.kind === 'ready' ? profile?.status ?? null : null);
	const name = $derived(profile?.display_name ?? undefined);

	// Prefill once the profile has loaded — first paint is pre-session, so
	// seed on the first settle. null (no RSVP yet, the column's default)
	// stays an empty field, and clearing the field is not a way to
	// un-RSVP: saving empty is refused and the saved number stands.
	// (A number input binds a number — or '' while empty — in Svelte 5.)
	$effect(() => {
		if (seeded) return;
		const ps = profile?.party_size;
		if (ps === null || typeof ps === 'number') {
			count = ps ?? '';
			seeded = true;
		}
	});

	async function save() {
		if (busy || !profile) return;
		// An RSVP is a whole number of people, 0 to PARTY_MAX. Empty input
		// (count === '') is refused for the same message as out-of-range.
		const n = count === '' ? NaN : Number(count);
		if (!Number.isInteger(n) || n < 0 || n > PARTY_MAX) {
			formError = `Tell us how many of you are coming — 0 to ${PARTY_MAX}.`;
			saved = false;
			return;
		}
		busy = true;
		formError = null;
		// Self-PATCH of party_size — with display_name, the only columns
		// the guard trigger lets a user write (knowledge/db/users.md).
		const { error } = await supabase
			.from('users')
			.update({ party_size: n })
			.eq('id', profile.id);
		busy = false;
		if (error) {
			formError = `Couldn’t save your RSVP (${error.message}). Please try again.`;
			return;
		}
		saved = true;
		// Re-read our row so the session's party_size follows the save.
		await refreshState();
	}
</script>

<svelte:head>
	<title>RSVP — juneau.love</title>
</svelte:head>

{#if auth.kind === 'anonymous'}
	<div class="card center">
		<h2 class="display" style="font-size: 2rem">We’d love to know</h2>
		<p class="sub">Sign in to let us know how many of you are coming.</p>
		<div class="spread">
			<a class="btn" href="/login">Sign in</a>
		</div>
	</div>
{:else if auth.kind === 'error'}
	<StateScreen status="error" message={auth.message} />
{:else if status === 'pending'}
	<StateScreen status="pending" name={name} />
{:else if status === 'rejected'}
	<StateScreen status="rejected" name={name} />
{:else if auth.kind === 'ready' && profile}
	<div class="card">
		<h2 class="display" style="font-size: 2rem">RSVP</h2>
		<p class="sub">Let us know how many people in your party will be with us.</p>
		<!-- novalidate: the app shows its own range message; without this
		     the browser's constraint validation could swallow the submit. -->
		<form
			novalidate
			onsubmit={(e) => {
				e.preventDefault();
				void save();
			}}
		>
			<label class="field">
				How many of you are coming?
				<input
					bind:value={count}
					type="number"
					inputmode="numeric"
					min="0"
					max={PARTY_MAX}
					step="1"
					oninput={() => (saved = false)}
				/>
			</label>
			{#if formError}
				<p class="msg err" role="alert">{formError}</p>
			{/if}
			{#if saved}
				<p class="msg ok" role="status">Thank you — your RSVP is saved.</p>
			{/if}
			<div class="spread">
				<button class="btn" type="submit" disabled={busy}>
					{busy ? 'Saving…' : 'Save RSVP'}
				</button>
			</div>
		</form>
	</div>
{/if}
