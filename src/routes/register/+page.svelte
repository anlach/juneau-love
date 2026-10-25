<script lang="ts">
	import { type AuthError } from '@supabase/supabase-js';
	import { supabase } from '#lib/supabase';
	import { auth } from '#lib/session.svelte.ts';

	let name = $state('');
	let email = $state('');
	let busy = $state(false);
	let formError = $state<string | null>(null);
	let registered = $state(false);
	let registeredEmail = $state('');
	// 1-based while the signup call (incl. retries) is in flight, else 0.
	let attempt = $state(0);

	// Safe view over the nullable profile (TS can't narrow from `auth.kind`).
	const profile = $derived(auth.profile);

	const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

	// The real signup call can fail with a 500 when GoTrue's confirmation
	// email is temp-rejected at the *recipient's* gateway (observed:
	// umich.edu's MX 451s "denied by local policy" intermittently while
	// multipart mail from the same IP is accepted — knowledge/platform/
	// bugs.md). Such a failure rolls the whole signup back (GoTrue commits
	// user + email in one transaction), so retrying is a clean fresh
	// attempt; a few tries with backoff ride out the gateway's temp window.
	const SIGNUP_ATTEMPTS = 4;
	const SIGNUP_RETRY_DELAYS_MS = [10_000, 30_000, 60_000];

	const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

	async function submit() {
		if (busy) return;
		const trimmedName = name.trim();
		const trimmedEmail = email.trim().toLowerCase();
		if (!trimmedName) {
			formError = 'Please tell us your name.';
			return;
		}
		if (!EMAIL_RE.test(trimmedEmail)) {
			formError = 'That email doesn’t look quite right.';
			return;
		}
		busy = true;
		formError = null;
		// Registration goes through GoTrue's magic-link endpoint (`/otp`),
		// not `/signup`: the signup endpoint refuses an email-only body
		// ("Signup requires a valid password"), while the magic-link endpoint
		// signs an unknown email up — with a server-generated credential the
		// guest never sees — and emails the confirmation link
		// (knowledge/api/client-auth.md, Flow 1).
		//
		// First probe with `shouldCreateUser: false`: it succeeds only for an
		// email that is already registered, which is how a new guest is told
		// apart from a returning one without an account lookup. (The probe
		// also emails the returning guest a login link — what the sign-in
		// page does, minus the cooldown.) A probe 429 means the same: the
		// probe only trips GoTrue's per-user email rate limit by sending a
		// link to a known address — a new address 422s before any send.
		const { error: probeError } = await supabase.auth.signInWithOtp({
			email: trimmedEmail,
			options: {
				shouldCreateUser: false,
				// a returning guest lands where their login link would
				emailRedirectTo: window.location.origin + '/login'
			}
		});
		if (!probeError || probeError.status === 429) {
			busy = false;
			formError =
				'An account with that email already exists — sign in instead, and we’ll sort it out from there.';
			return;
		}
		let signUpError: AuthError | null = null;
		for (let n = 1; n <= SIGNUP_ATTEMPTS; n++) {
			attempt = n;
			const { error } = await supabase.auth.signInWithOtp({
				email: trimmedEmail,
				options: {
					data: { display_name: trimmedName },
					// origin-derived: juneau.love in prod, http://localhost:3000 in dev
					emailRedirectTo: window.location.origin + '/auth/confirm'
				}
			});
			signUpError = error;
			// Only a server-side 500 (e.g. the confirmation email being
			// temp-rejected) is worth retrying now; 4xx (rate limit, bad
			// input) won't heal on an immediate retry.
			if (!error || error.status !== 500 || n === SIGNUP_ATTEMPTS) break;
			await delay(SIGNUP_RETRY_DELAYS_MS[n - 1]);
		}
		busy = false;
		attempt = 0;
		if (signUpError) {
			formError =
				signUpError.status === 500
					? 'We couldn’t send the confirmation email just now — please try again in a few minutes.'
					: `Registration didn’t go through (${signUpError.message}). Please try again.`;
			return;
		}
		// Alert the admins a registration is waiting. Best effort and never
		// blocks the guest: if this call doesn't go through, the layout fires
		// the same notification once the guest is signed in on the
		// awaiting-approval screen, and the function is idempotent (the
		// users.admin_notified_at stamp — knowledge/api/notify-registration.md).
		void supabase
			.functions.invoke('notify-registration', { body: { email: trimmedEmail } })
			.then(({ error: notifyError }) => {
				if (notifyError) console.warn('notify-registration failed:', notifyError);
			});
		registeredEmail = trimmedEmail;
		registered = true;
	}
</script>

<svelte:head>
	<title>Register — juneau.love</title>
</svelte:head>

{#if auth.kind === 'ready'}
	<div class="card center">
		<h2 class="display" style="font-size: 2rem">You’re already signed in</h2>
		<p>
			This browser is signed in as <strong>{profile?.display_name ?? 'you'}</strong>
			({profile?.status ?? '…'}).
		</p>
		<div class="spread">
			<a class="btn ghost" href="/">Back home</a>
		</div>
	</div>
{:else if registered}
	<div class="card center">
		<h2 class="display" style="font-size: 2rem">Check your email</h2>
		<p>
			We’ve sent a confirmation link to <strong>{registeredEmail}</strong>. That’s step 1 of
			2: click it to confirm your address, and then a human will give your registration a
			final once-over.
		</p>
		<p class="sub">Links in emails are how you get in.</p>
		<div class="spread">
			<a class="btn ghost" href="/">Back home</a>
		</div>
	</div>
{:else}
	<div class="card">
		<h2 class="display" style="font-size: 2rem">Register</h2>
		<p class="sub">
			Just your name and email. After you confirm your address, a human gives your
			registration a final check.
		</p>
		<!-- novalidate: the app shows its own name/email errors; without this
		     the browser's type=email constraint validation swallows the submit. -->
		<form
			novalidate
			onsubmit={(e) => {
				e.preventDefault();
				void submit();
			}}
		>
			<label class="field">
				Your name
				<input
					bind:value={name}
					type="text"
					autocomplete="name"
					placeholder="e.g. Alex Doe"
				/>
			</label>
			<label class="field">
				Email
				<input
					bind:value={email}
					type="email"
					autocomplete="email"
					placeholder="you@example.com"
				/>
			</label>
			{#if formError}
				<p class="msg err" role="alert">{formError}</p>
			{/if}
			<div class="spread">
				<button class="btn" type="submit" disabled={busy}>
					{#if busy && attempt > 1}
						Registering… (attempt {attempt} of {SIGNUP_ATTEMPTS})
					{:else}
						{busy ? 'Registering…' : 'Request access'}
					{/if}
				</button>
			</div>
		</form>
	</div>
{/if}
