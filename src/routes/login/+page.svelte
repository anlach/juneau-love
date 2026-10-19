<script lang="ts">
	import { goto } from '$app/navigation';
	import { supabase } from '#lib/supabase';
	import { auth } from '#lib/session.svelte.ts';

	let email = $state('');
	let busy = $state(false);
	let sent = $state(false);
	let notice = $state<{ tone: 'ok' | 'err'; text: string } | null>(null);

	const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

	// A valid login link landed here with the session in the fragment and
	// supabase-js installed it — send the guest to their content.
	$effect(() => {
		if (auth.kind === 'ready') void goto('/', { replaceState: true });
	});

	async function submit() {
		const trimmed = email.trim().toLowerCase();
		if (!EMAIL_RE.test(trimmed)) {
			notice = { tone: 'err', text: 'That email doesn’t look quite right.' };
			return;
		}
		busy = true;
		notice = null;
		sent = false;
		const { data, error } = await supabase.functions.invoke('send-login-link', {
			body: { email: trimmed }
		});
		busy = false;

		if (!error && data) {
			if (data.sent) {
				sent = true;
				notice = {
					tone: 'ok',
					text: 'A sign-in link is on its way. Check your inbox and click it to get in.'
				};
			} else if (data.reason === 'not_found') {
				notice = {
					tone: 'err',
					text: 'That email isn’t registered yet. Register first and we’ll take it from there.'
				};
			} else {
				// not_approved — pending (or rejected). No link is sent.
				notice = {
					tone: 'err',
					text:
						'You’re registered, but your access hasn’t been approved yet. Nothing more to do on your end — you’ll get a link once you’re in.'
				};
			}
			return;
		}

		// Non-2xx (400 / 429 / 502)
		const status = (error as { status?: number })?.status;
		if (status === 429) {
			notice = {
				tone: 'err',
				text: 'We sent one of these recently — check your inbox before asking for another.'
			};
		} else if (status === 400) {
			notice = { tone: 'err', text: 'That email doesn’t look quite right.' };
		} else {
			notice = {
				tone: 'err',
				text: 'We couldn’t send the link just now. Please try again in a moment.'
			};
		}
	}
</script>

<svelte:head>
	<title>Sign in — juneau.love</title>
</svelte:head>

<div class="card">
	<h2 class="display" style="font-size: 2rem">Sign in</h2>
	<p class="sub">
		There’s no password here. Tell us your email and we’ll send you a link that signs you in.
	</p>

	{#if auth.linkError}
		<p class="msg err" role="alert">
			{auth.linkError}
		</p>
	{/if}

	{#if sent}
		<p class="msg ok" role="status">{notice?.text}</p>
	{:else}
		<!-- novalidate: the app shows its own email error; without this the
		     browser's type=email constraint validation swallows the submit. -->
		<form
			novalidate
			onsubmit={(e) => {
				e.preventDefault();
				void submit();
			}}
		>
			<label class="field">
				Email
				<input
					bind:value={email}
					type="email"
					autocomplete="email"
					placeholder="you@example.com"
				/>
			</label>
			{#if notice}
				<p class="msg {notice.tone}" role="alert">{notice.text}</p>
			{/if}
			<div class="spread" style="justify-content: flex-start">
				<button class="btn" type="submit" disabled={busy}>
					{busy ? 'Sending…' : 'Email me a link'}
				</button>
			</div>
		</form>
	{/if}

	<p class="sub" style="margin-bottom: 0">
		New here? <a href="/register">Register first</a>.
	</p>
</div>
