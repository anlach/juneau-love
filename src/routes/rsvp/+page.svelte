<script lang="ts">
	import { supabase } from '#lib/supabase';
	import { auth, refreshState } from '#lib/session.svelte.ts';
	import StateScreen from '#lib/components/StateScreen.svelte';

	// A party is at most eight people per event; the DB CHECKs are the
	// backstop for hand-crafted writes (knowledge/db/users.md).
	const PARTY_MAX = 8;

	// The number inputs' bound values are not ground truth: Svelte 5
	// coerces the DOM string, so an *empty* field becomes Number('') === 0
	// — and 0 is a valid value here ("not coming"). The raw DOM value is
	// what we validate; the bindings exist only to prefill the fields.
	let weddingInput = $state<HTMLInputElement | null>(null);
	let whaleInput = $state<HTMLInputElement | null>(null);
	let wedding = $state<number | ''>('');
	let whale = $state<number | ''>('');
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
	// seed on the first settle. null (no RSVP yet, the columns' default)
	// stays an empty field; clearing a field is not a way to un-RSVP
	// (saving empty is refused and the saved numbers stand).
	$effect(() => {
		if (seeded) return;
		const ps = profile?.party_size;
		const ws = profile?.whale_watch_party_size;
		const settled = (v: unknown) => v === null || typeof v === 'number';
		if (settled(ps) && settled(ws)) {
			wedding = ps ?? '';
			whale = ws ?? '';
			seeded = true;
		}
	});

	// A count is a whole number of people, 0 to PARTY_MAX. Read from the
	// DOM so an emptied field is refused, not mistaken for 0.
	function readCount(el: HTMLInputElement | null): number | null {
		const raw = (el?.value ?? '').trim();
		const n = Number(raw);
		if (raw === '' || !Number.isInteger(n) || n < 0 || n > PARTY_MAX) return null;
		return n;
	}

	async function save() {
		if (busy || !profile) return;
		// Both events need a decision (0 is "not coming"); one empty or
		// out-of-range field refuses the whole save, and the saved
		// numbers stand.
		const w = readCount(weddingInput);
		const x = readCount(whaleInput);
		if (w === null || x === null) {
			formError = `Tell us how many are coming — 0 to ${PARTY_MAX}.`;
			saved = false;
			return;
		}
		busy = true;
		formError = null;
		// Self-PATCH of the two RSVP counts — with display_name, the only
		// columns the guard trigger lets a user write
		// (knowledge/db/users.md).
		const { error } = await supabase
			.from('users')
			.update({ party_size: w, whale_watch_party_size: x })
			.eq('id', profile.id);
		busy = false;
		if (error) {
			formError = `Couldn’t save your RSVP (${error.message}). Please try again.`;
			return;
		}
		saved = true;
		// Re-read our row so the session's RSVP counts follow the save.
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
		<p class="sub">
			Let us know how many of you are coming to the wedding — and how many would like to
			join us for the <a href="/whale-watching">whale watch</a> the day before.
		</p>
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
				Wedding (Sat, June 19) — how many of you are coming?
				<input
					bind:value={wedding}
					bind:this={weddingInput}
					type="number"
					inputmode="numeric"
					min="0"
					max={PARTY_MAX}
					step="1"
					oninput={() => (saved = false)}
				/>
			</label>
			<label class="field">
				Whale watch (Fri, June 18) — how many of you are coming?
				<input
					bind:value={whale}
					bind:this={whaleInput}
					type="number"
					inputmode="numeric"
					min="0"
					max={PARTY_MAX}
					step="1"
					oninput={() => (saved = false)}
				/>
			</label>
			<p class="sub">
				Feel free to register separately, but don’t double-count yourselves — these
				will be summed for a final headcount. Please update it if your plans change.
			</p>
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
