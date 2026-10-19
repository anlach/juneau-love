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
		// Passwordless (magic-link) signup: no password field anywhere in the flow.
		// supabase-js's `signUp` type only declares the password-credential shape,
		// but the GoTrue `/signup` endpoint — and the client runtime, which POSTs
		// `password: undefined` — accepts an email-only body for passwordless
		// signups, so we assert the credentials to the declared parameter type.
		const credentials = {
			email: trimmedEmail,
			options: {
				data: { display_name: trimmedName },
				// origin-derived: juneau.love in prod, http://localhost:3000 in dev
				emailRedirectTo: window.location.origin + '/auth/confirm'
			}
		} as unknown as Parameters<typeof supabase.auth.signUp>[0];
		const { error } = await supabase.auth.signUp(credentials);
		busy = false;
		if (error) {
			if (/already registered|already been registered/i.test(error.message)) {
				formError =
					'An account with that email already exists — sign in instead, and we’ll sort it out from there.';
			} else {
				formError = `Registration didn’t go through (${error.message}). Please try again.`;
			}
			return;
		}
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
		<p class="sub">No password, ever — links in emails are how you get in.</p>
		<div class="spread">
			<a class="btn ghost" href="/">Back home</a>
		</div>
	</div>
{:else}
	<div class="card">
		<h2 class="display" style="font-size: 2rem">Register</h2>
		<p class="sub">
			Just your name and email — no password. After you confirm your address, a human
			gives your registration a final check.
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
