<script lang="ts">
	import { supabase } from '#lib/supabase';
	import { auth, refreshState } from '#lib/session.svelte.ts';
	import StateScreen from '#lib/components/StateScreen.svelte';

	let name = $state('');
	let seeded = $state(false);
	let busy = $state(false);
	let formError = $state<string | null>(null);
	let saved = $state(false);

	// Safe view over the nullable profile (TS can't narrow from `auth.kind`).
	const profile = $derived(auth.profile);

	// Prefill once the profile has loaded — first paint is still
	// pre-session, so seed on the first non-null display_name.
	$effect(() => {
		if (seeded) return;
		const dn = profile?.display_name;
		if (typeof dn === 'string') {
			name = dn;
			seeded = true;
		}
	});

	async function save() {
		if (busy || !profile) return;
		const trimmed = name.trim();
		if (!trimmed) {
			formError = 'Please tell us your name.';
			saved = false;
			return;
		}
		busy = true;
		formError = null;
		// Self-PATCH of display_name — the only column the guard trigger
		// lets a user write (knowledge/db/users.md). Not gated on approval
		// status: the guard has no status condition, so any signed-in
		// user may edit the name.
		const { error } = await supabase
			.from('users')
			.update({ display_name: trimmed })
			.eq('id', profile.id);
		busy = false;
		if (error) {
			formError = `Couldn’t save your name (${error.message}). Please try again.`;
			return;
		}
		saved = true;
		// Re-read our row so the header's .who follows the new name.
		await refreshState();
	}
</script>

<svelte:head>
	<title>Change name — juneau.love</title>
</svelte:head>

{#if auth.kind === 'anonymous'}
	<div class="card center">
		<h2 class="display" style="font-size: 2rem">A name for your account</h2>
		<p class="sub">Sign in to change the name the site shows for you.</p>
		<div class="spread">
			<a class="btn" href="/login">Sign in</a>
		</div>
	</div>
{:else if auth.kind === 'error'}
	<StateScreen status="error" message={auth.message} />
{:else if auth.kind === 'ready' && profile}
	<div class="card">
		<h2 class="display" style="font-size: 2rem">Change name</h2>
		<p class="sub">This is the name the site shows for you — it’s yours to change.</p>
		<!-- novalidate: the app shows its own name error; without this the
		     browser's constraint validation could swallow the submit. -->
		<form
			novalidate
			onsubmit={(e) => {
				e.preventDefault();
				void save();
			}}
		>
			<label class="field">
				Your name
				<input
					bind:value={name}
					type="text"
					autocomplete="name"
					oninput={() => (saved = false)}
				/>
			</label>
			{#if formError}
				<p class="msg err" role="alert">{formError}</p>
			{/if}
			{#if saved}
				<p class="msg ok" role="status">Name updated.</p>
			{/if}
			<div class="spread">
				<button class="btn" type="submit" disabled={busy}>
					{busy ? 'Saving…' : 'Save name'}
				</button>
			</div>
		</form>
	</div>
{/if}
