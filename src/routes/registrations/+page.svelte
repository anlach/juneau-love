<script lang="ts">
	import { supabase } from '#lib/supabase';
	import { auth, hasPermission } from '#lib/session.svelte.ts';
	import StateScreen from '#lib/components/StateScreen.svelte';

	interface Registration {
		id: string;
		email: string;
		display_name: string;
		email_confirmed_at: string | null;
		status: 'pending' | 'approved' | 'rejected';
		created_at: string;
	}

	let rows = $state<Registration[]>([]);
	let loading = $state(true);
	let notice = $state<{ tone: 'ok' | 'err'; text: string } | null>(null);
	let acting = $state<string | null>(null); // row id mid-flight

	const isReadAdmin = $derived(auth.kind === 'ready' && hasPermission('registrations:read'));
	const canApprove = $derived(hasPermission('registrations:approve'));
	const canReject = $derived(hasPermission('registrations:reject'));
	const status = $derived(auth.kind === 'ready' ? auth.profile?.status ?? null : null);
	const name = $derived(auth.profile?.display_name ?? undefined);

	// Auth resolves *after* first render (the magic-link session is installed
	// client-side), so onMount would see `isReadAdmin === false` and never
	// load. React to readiness instead; `hasLoaded` keeps it a one-shot.
	let hasLoaded = $state(false);
	$effect(() => {
		if (isReadAdmin && !hasLoaded) {
			hasLoaded = true;
			void load();
		}
	});

	async function load() {
		loading = true;
		const { data, error } = await supabase
			.from('users')
			.select('id, email, display_name, email_confirmed_at, status, created_at')
			.order('created_at', { ascending: false });
		rows = (error || !data ? [] : (data as Registration[]));
		loading = false;
	}

	async function decide(row: Registration, decision: 'approve' | 'reject') {
		acting = row.id;
		notice = null;
		const { data, error } = await supabase.functions.invoke('registration-decision', {
			body: { target_user_id: row.id, decision }
		});
		acting = null;

		if (error || !data) {
			notice = {
				tone: 'err',
				text:
					errorCode(error) === 'email_not_confirmed'
						? 'Their email isn’t confirmed yet, so it can’t be approved. You can reject it.'
						: errorCode(error) === 'invalid_transition'
							? 'That change isn’t allowed from the current state.'
							: 'That didn’t go through. Please try again.'
			};
			// The row's state may have changed under us; re-sync.
			void load();
			return;
		}

		const sent = data.email_sent;
		notice =
			decision === 'approve'
				? {
						tone: 'ok',
						text: sent
							? `${row.display_name} approved — their sign-in link is on its way.`
							: `${row.display_name} approved. (The link email didn’t send here; they can request one on the sign-in page.)`
					}
				: { tone: 'ok', text: `${row.display_name} rejected.` };
		void load();
	}

	function errorCode(error: unknown): string | null {
		const ctx = (error as { context?: { error?: string } })?.context;
		return ctx?.error ?? null;
	}

	function fmtDate(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}
</script>

<svelte:head>
	<title>Registrations — juneau.love</title>
</svelte:head>

{#if auth.kind === 'anonymous'}
	<div class="card center">
		<h2 class="display" style="font-size: 2rem">Sign in to continue</h2>
		<div class="spread"><a class="btn" href="/login">Sign in</a></div>
	</div>
{:else if status === 'pending'}
	<StateScreen status="pending" name={name} />
{:else if status === 'rejected'}
	<StateScreen status="rejected" name={name} />
{:else if auth.kind === 'error'}
	<StateScreen status="error" message={auth.message} />
{:else if isReadAdmin}
	<h1 class="display" style="font-size: 2.6rem">Registrations</h1>
	<p class="sub">Newest first. A guest can only be approved once their email is confirmed.</p>

	{#if notice}
		<p class="msg {notice.tone}" role="status">{notice.text}</p>
	{/if}

	{#if loading}
		<p class="sub">Loading…</p>
	{:else}
		<table class="table">
			<thead>
				<tr>
					<th>Name</th>
					<th>Email</th>
					<th>Registered</th>
					<th>Email</th>
					<th>Status</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.id)}
					<tr>
						<td>{row.display_name}</td>
						<td>{row.email}</td>
						<td>{fmtDate(row.created_at)}</td>
						<td>{row.email_confirmed_at ? '✓ verified' : 'not yet'}</td>
						<td><span class="badge {row.status}">{row.status}</span></td>
						<td class="actions">
							{#if row.status === 'pending'}
								<button
									class="btn"
									disabled={!canApprove || !row.email_confirmed_at || acting === row.id}
									onclick={() => decide(row, 'approve')}
								>
									Approve
								</button>
								<button
									class="btn danger"
									disabled={!canReject || acting === row.id}
									onclick={() => decide(row, 'reject')}
								>
									Reject
								</button>
							{:else if row.status === 'approved'}
								<button
									class="btn danger"
									disabled={!canReject || acting === row.id}
									onclick={() => decide(row, 'reject')}
								>
									Reject
								</button>
							{:else}
								<!-- rejected: only re-approve (needs a verified email) -->
								<button
									class="btn"
									disabled={!canApprove || !row.email_confirmed_at || acting === row.id}
									onclick={() => decide(row, 'approve')}
								>
									Approve
								</button>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
{:else}
	<div class="card center">
		<h2 class="display" style="font-size: 2rem">Not available to you</h2>
		<p class="sub">This page is only for the site’s administrators.</p>
		<div class="spread"><a class="btn ghost" href="/">Back home</a></div>
	</div>
{/if}
