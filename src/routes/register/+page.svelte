<script lang="ts">
	import { supabase } from '#lib/supabase';
	import { auth } from '#lib/session.svelte.ts';

	let name = $state('');
	let email = $state('');
	let busy = $state(false);
	let formError = $state<string | null>(null);
	let registered = $state(false);
	let registeredEmail = $state('');

	// Safe view over the nullable profile (TS can't narrow from `auth.kind`).
	const profile = $derived(auth.profile);

	const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
		const { error } = await supabase.auth.signInWithOtp({
			email: trimmedEmail,
			options: {
				data: { display_name: trimmedName },
				// origin-derived: juneau.love in prod, http://localhost:3000 in dev
				emailRedirectTo: window.location.origin + '/auth/confirm'
			}
		});
		busy = false;
		if (error) {
			formError = `Registration didn’t go through (${error.message}). Please try again.`;
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
					{busy ? 'Registering…' : 'Request access'}
				</button>
			</div>
		</form>
	</div>
{/if}
