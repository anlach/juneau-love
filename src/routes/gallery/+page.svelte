<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '#lib/supabase';
	import { auth } from '#lib/session.svelte.ts';
	import { cacheUrl, getCachedUrl } from '#lib/presign';
	import StateScreen from '#lib/components/StateScreen.svelte';

	interface Asset {
		id: string;
		user_id: string;
		content_type: string;
		caption: string | null;
		created_at: string;
	}

	const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
	const MAX_BYTES = 5 * 1024 * 1024;

	let assets = $state<Asset[]>([]);
	let names = $state<Record<string, string>>({});
	let urls = $state<Record<string, string>>({});
	let loading = $state(true);
	let s3Available = $state(true);

	let uploading = $state(false);
	let uploadMsg = $state<{ tone: 'ok' | 'err'; text: string } | null>(null);
	let fileInput: HTMLInputElement | undefined = $state();

	const status = $derived(auth.kind === 'ready' ? auth.profile?.status ?? null : null);
	const name = $derived(auth.profile?.display_name ?? undefined);
	const approved = $derived(status === 'approved');

	onMount(() => {
		if (approved) void load();
	});

	async function load() {
		loading = true;
		const { data, error } = await supabase
			.from('assets')
			.select('id, user_id, content_type, caption, created_at')
			.order('created_at', { ascending: false });
		if (error || !data) {
			// RLS/network failure: degrade to "no access", never over-show.
			assets = [];
			loading = false;
			return;
		}
		assets = data as Asset[];

		// Batched uploader display names (guest_names view — a direct users
		// join is blocked by users' self-only RLS).
		const uploaderIds = [...new Set(assets.map((a) => a.user_id))];
		if (uploaderIds.length) {
			const { data: nameRows } = await supabase
				.from('guest_names')
				.select('id, display_name')
				.in('id', uploaderIds);
			const map: Record<string, string> = {};
			for (const r of nameRows ?? []) map[r.id] = r.display_name;
			names = map;
		} else {
			names = {};
		}

		await fetchUrls(assets.map((a) => a.id));
		loading = false;
	}

	async function fetchUrls(ids: string[]) {
		// Only sign for what we don't already hold (cached until near expiry).
		const missing = ids.filter((id) => !getCachedUrl(id));
		if (!missing.length) {
			syncUrls();
			return;
		}
		s3Available = true;
		for (let i = 0; i < missing.length; i += 100) {
			const chunk = missing.slice(i, i + 100);
			const { data, error } = await supabase.functions.invoke('asset-url', {
				body: { asset_ids: chunk }
			});
			if (error) {
				// 500 unavailable (e.g. no S3 configured locally) — keep
				// placeholders; a signed URL is never faked.
				s3Available = false;
				continue;
			}
			for (const u of data?.urls ?? []) {
				cacheUrl(u.asset_id, u.url, Date.parse(u.expires_at));
			}
		}
		syncUrls();
	}

	function syncUrls() {
		const map: Record<string, string> = {};
		for (const a of assets) {
			const url = getCachedUrl(a.id);
			if (url) map[a.id] = url;
		}
		urls = map;
	}

	async function onPickFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		uploadMsg = null;

		if (!ALLOWED.includes(file.type)) {
			uploadMsg = { tone: 'err', text: 'Only JPEG, PNG, or WebP images, please.' };
			return;
		}
		if (file.size > MAX_BYTES) {
			uploadMsg = { tone: 'err', text: 'That image is over the 5 MB limit.' };
			return;
		}

		uploading = true;
		try {
			const { data, error } = await supabase.functions.invoke('asset-upload-url', {
				body: { filename: file.name, content_type: file.type, byte_size: file.size }
			});
			if (error || !data) {
				uploadMsg = {
					tone: 'err',
					text:
						(statusOf(error) === 'unavailable'
							? 'Uploads aren’t available in this environment right now.'
							: 'We couldn’t start that upload. Please try again.')
				};
				return;
			}

			const put = await fetch(data.upload_url, {
				method: 'PUT',
				headers: { 'content-type': file.type },
				body: file
			});
			if (!put.ok) {
				uploadMsg = { tone: 'err', text: 'The upload didn’t go through. Please try again.' };
				return;
			}

			const { error: insertError } = await supabase.from('assets').insert({
				user_id: auth.kind === 'ready' ? auth.profile?.id : undefined,
				s3_key: data.s3_key,
				content_type: file.type,
				byte_size: file.size
			});
			if (insertError) {
				uploadMsg = { tone: 'err', text: 'Saved the image, but not the record. Please try again.' };
				return;
			}
			uploadMsg = { tone: 'ok', text: 'Added — thank you!' };
			void load();
		} finally {
			uploading = false;
		}
	}

	function statusOf(error: unknown): string | null {
		const ctx = (error as { context?: { error?: string } })?.context;
		return ctx?.error ?? null;
	}
</script>

<svelte:head>
	<title>Photos — juneau.love</title>
</svelte:head>

{#if auth.kind === 'anonymous'}
	<div class="card center">
		<h2 class="display" style="font-size: 2rem">A private photo corner</h2>
		<p class="sub">Sign in (or register) to see the photos our guests have shared.</p>
		<div class="spread">
			<a class="btn" href="/login">Sign in</a>
			<a class="btn ghost" href="/register">Register</a>
		</div>
	</div>
{:else if status === 'pending'}
	<StateScreen status="pending" name={name} />
{:else if status === 'rejected'}
	<StateScreen status="rejected" name={name} />
{:else if auth.kind === 'error'}
	<StateScreen status="error" message={auth.message} />
{:else if auth.kind === 'ready' && approved}
	<h1 class="display" style="font-size: 2.6rem">Photos</h1>

	<div class="upload">
		<input
			type="file"
			accept="image/jpeg,image/png,image/webp"
			hidden
			bind:this={fileInput}
			onchange={onPickFile}
		/>
		<button class="btn" type="button" disabled={uploading} onclick={() => fileInput?.click()}>
			{uploading ? 'Uploading…' : 'Add a photo'}
		</button>
		{#if uploadMsg}
			<span class="msg {uploadMsg.tone}">{uploadMsg.text}</span>
		{/if}
	</div>

	{#if loading}
		<p class="sub">Loading…</p>
	{:else if assets.length === 0}
		<p class="sub">No photos yet — be the first to share one.</p>
	{:else}
		<div class="gallery-grid">
			{#each assets as asset (asset.id)}
				<figure>
					{#if urls[asset.id]}
						<img src={urls[asset.id]} alt={asset.caption ?? 'A shared photo'} loading="lazy" />
					{:else}
						<div class="placeholder" role="img" aria-label="Image unavailable"></div>
					{/if}
					<figcaption>
						{#if names[asset.user_id]}
							<span class="uploader">{names[asset.user_id]}</span>
						{/if}
						{#if asset.caption} · {asset.caption}{/if}
					</figcaption>
				</figure>
			{/each}
		</div>
	{/if}
{/if}

{#if !s3Available && approved && assets.length > 0}
	<p class="sub center">
		{assets.length} photo{assets.length === 1 ? '' : 's'} shared — image previews need the
		storage backend, which isn’t connected in this environment.
	</p>
{/if}

<style>
	.upload {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin: 0.5rem 0 0.5rem;
	}
</style>
