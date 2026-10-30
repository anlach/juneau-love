<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '#lib/supabase';
	import { auth } from '#lib/session.svelte.ts';
	import { cacheUrl, getCached, dropCached } from '#lib/presign';
	import { functionErrorCode } from '#lib/fn-error';
	import StateScreen from '#lib/components/StateScreen.svelte';
	import JSZip from 'jszip';

	interface Asset {
		id: string;
		user_id: string;
		content_type: string;
		caption: string | null;
		created_at: string;
	}

	const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
	const MAX_BYTES = 5 * 1024 * 1024;

	// Client-side thumbnail: long edge 800 px, WebP quality 0.8
	// (knowledge/stories/guest-gallery.md) — generated before the presign
	// call so the function can size-check the declared bytes.
	const THUMB_LONG_EDGE = 800;
	const THUMB_QUALITY = 0.8;

	let assets = $state<Asset[]>([]);
	let names = $state<Record<string, string>>({});
	let urls = $state<Record<string, { url: string; thumbUrl: string | null }>>({});
	let loading = $state(true);
	let s3Available = $state(true);

	let uploading = $state(false);
	let uploadMsg = $state<{ tone: 'ok' | 'err'; text: string } | null>(null);
	let fileInput: HTMLInputElement | undefined = $state();

	// Selection (knowledge/stories/download-photos.md, delete-photos.md):
	// ids of the checked cells; one selection drives both the Download and
	// the Delete toolbar buttons. While non-empty the grid keeps every
	// checkbox visible.
	let selectedIds = $state<string[]>([]);
	let downloading = $state(false);
	let downloadMsg = $state<{ tone: 'ok' | 'err'; text: string } | null>(null);
	let deleting = $state(false);
	let deleteMsg = $state<{ tone: 'ok' | 'err'; text: string } | null>(null);
	const selecting = $derived(selectedIds.length > 0);

	// The delete gate mirrors the BE rule (knowledge/db/assets.md): own
	// rows, or any row for an admin. In v1 only the admin role holds
	// permissions (knowledge/db/rbac.md), so a non-empty permission set is
	// the admin marker.
	const myId = $derived(auth.profile?.id ?? null);
	const isAdmin = $derived(auth.kind === 'ready' && auth.perms.length > 0);
	const canDeleteSelection = $derived(
		selectedIds.length > 0 &&
			selectedIds.every((id) => {
				const a = assets.find((x) => x.id === id);
				return !!a && (isAdmin || a.user_id === myId);
			})
	);

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

		// Drop selections whose rows no longer exist (removal is out-of-band;
		// a stale id would otherwise be an invisible, undeletable selection).
		const ids = new Set(assets.map((a) => a.id));
		selectedIds = selectedIds.filter((id) => ids.has(id));

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
		const missing = ids.filter((id) => !getCached(id));
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
				// thumb_url is absent for rows without a thumbnail; the grid
				// falls back to the full-size url for those.
				cacheUrl(u.asset_id, u.url, u.thumb_url ?? null, Date.parse(u.expires_at));
			}
		}
		syncUrls();
	}

	function syncUrls() {
		const map: Record<string, { url: string; thumbUrl: string | null }> = {};
		for (const a of assets) {
			const entry = getCached(a.id);
			if (entry) map[a.id] = { url: entry.url, thumbUrl: entry.thumbUrl };
		}
		urls = map;
	}

	/**
	 * Browser-side thumbnail: proportional downscale (long edge 800 px,
	 * never upscaled) re-encoded as WebP q0.8. Runs before the presign call
	 * so `thumb_byte_size` is known for the request. createImageBitmap
	 * applies the image's EXIF orientation, so the thumbnail is upright.
	 */
	async function makeThumbnail(file: File): Promise<Blob> {
		const bitmap = await createImageBitmap(file);
		try {
			const scale = Math.min(1, THUMB_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
			const w = Math.max(1, Math.round(bitmap.width * scale));
			const h = Math.max(1, Math.round(bitmap.height * scale));
			const canvas = document.createElement('canvas');
			canvas.width = w;
			canvas.height = h;
			const ctx = canvas.getContext('2d');
			if (!ctx) throw new Error('no 2d canvas context');
			ctx.drawImage(bitmap, 0, 0, w, h);
			const blob = await new Promise<Blob>((resolve, reject) =>
				canvas.toBlob(
					(b) => (b ? resolve(b) : reject(new Error('webp encoding failed'))),
					'image/webp',
					THUMB_QUALITY
				)
			);
			if (blob.type !== 'image/webp') throw new Error('webp encoding unsupported');
			return blob;
		} finally {
			bitmap.close();
		}
	}

	// ---- download ----

	const EXT: Record<string, string> = {
		'image/jpeg': 'jpg',
		'image/png': 'png',
		'image/webp': 'webp'
	};

	/** Caption → filename base: path-unsafe chars out, whitespace collapsed. */
	function safeBase(caption: string | null): string {
		const cleaned = (caption ?? '')
			.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		return cleaned || 'photo';
	}

	/** Unique-per-batch name: `caption.<ext>`, `-<id prefix>` on collision. */
	function downloadName(a: Asset, used: Set<string>): string {
		const base = safeBase(a.caption);
		const ext = EXT[a.content_type] ?? 'bin';
		let name = `${base}.${ext}`;
		if (used.has(name)) name = `${base}-${a.id.slice(0, 8)}.${ext}`;
		let n = 2;
		while (used.has(name)) name = `${base}-${n++}.${ext}`;
		used.add(name);
		return name;
	}

	/** Blob → saved file via a same-origin object URL (the `download`
	 *  attribute is ignored on cross-origin S3 navigations). */
	function triggerDownload(blob: Blob, filename: string): void {
		const href = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = href;
		a.download = filename;
		document.body.append(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(href), 10_000);
	}

	async function onDownload() {
		if (downloading) return;
		// Only cells that actually have a signed full-size URL are downloadable.
		const chosen = assets.filter((a) => selectedIds.includes(a.id) && urls[a.id]);
		if (!chosen.length) return;

		downloading = true;
		downloadMsg = null;
		const used = new Set<string>();
		const named = chosen.map((a) => ({ a, name: downloadName(a, used) }));
		try {
			// The cached presigned full-size URLs are the source: the S3
			// endpoint answers any-origin fetches (Access-Control-Allow-
			// Origin: *), so no new endpoint is needed to get bytes.
			const blobs = await Promise.all(
				named.map(async ({ a }) => {
					const res = await fetch(urls[a.id].url);
					if (!res.ok) throw new Error(`asset fetch failed: ${res.status}`);
					return res.blob();
				})
			);
			if (named.length === 1) {
				// One photo → the file itself, no zip wrapper.
				triggerDownload(blobs[0], named[0].name);
			} else {
				// Several → one zip (STORE is JSZip's default: photos are
				// already compressed, so no deflate CPU and no size surprise).
				const zip = new JSZip();
				named.forEach(({ name }, i) => zip.file(name, blobs[i]));
				triggerDownload(await zip.generateAsync({ type: 'blob' }), 'juneau-love-photos.zip');
			}
		} catch {
			downloadMsg = { tone: 'err', text: 'The download didn’t go through. Please try again.' };
		}
		finally {
			// The selection stays: retrying a failed download shouldn't force
			// the guest to re-check every box.
			downloading = false;
		}
	}

	// ---- delete ----

	async function onDelete() {
		if (deleting || !selectedIds.length) return;
		const count = selectedIds.length;
		// Destructive and final — one confirmation for the whole batch
		// (knowledge/design/selection-actions.md).
		if (!confirm(`Delete ${count} selected photo${count === 1 ? '' : 's'}? This can’t be undone.`))
			return;

		deleting = true;
		deleteMsg = null;
		const ids = [...selectedIds];
		try {
			const { data, error, response } = await supabase.functions.invoke('asset-delete', {
				body: { asset_ids: ids }
			});
			if (error || !data) {
				const code = await functionErrorCode(response);
				deleteMsg = {
					tone: 'err',
					text:
						code === 'unavailable'
							? 'Deleting isn’t available in this environment right now.'
							: 'We couldn’t delete those photos. Please try again.'
				};
				return;
			}
			// The response is the source of truth: it lists only the rows the
			// RLS actually let go. Everything else stays selected, so a retry
			// doesn't force re-checking (knowledge/stories/delete-photos.md).
			const deleted = new Set<string>(data.deleted ?? []);
			for (const id of deleted) dropCached(id);
			assets = assets.filter((a) => !deleted.has(a.id));
			selectedIds = selectedIds.filter((id) => !deleted.has(id));
			deleteMsg =
				deleted.size < ids.length
					? { tone: 'err', text: 'Some photos couldn’t be deleted. Please try again.' }
					: { tone: 'ok', text: `Deleted ${deleted.size} photo${deleted.size === 1 ? '' : 's'}.` };
		} catch {
			deleteMsg = { tone: 'err', text: 'We couldn’t delete those photos. Please try again.' };
		} finally {
			deleting = false;
		}
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
			const thumb = await makeThumbnail(file);

			const { data, error, response } = await supabase.functions.invoke('asset-upload-url', {
				body: {
					filename: file.name,
					content_type: file.type,
					byte_size: file.size,
					thumb_byte_size: thumb.size
				}
			});
			if (error || !data) {
				const code = await functionErrorCode(response);
				uploadMsg = {
					tone: 'err',
					text:
						code === 'unavailable'
							? 'Uploads aren’t available in this environment right now.'
							: 'We couldn’t start that upload. Please try again.'
				};
				return;
			}

			// Both PUTs must succeed before the row is inserted; a failed or
			// abandoned upload leaves orphan objects, which are tolerated in
			// v1 (knowledge/stories/guest-gallery.md).
			const putOriginal = await fetch(data.upload_url, {
				method: 'PUT',
				headers: { 'content-type': file.type },
				body: file
			});
			if (!putOriginal.ok) {
				uploadMsg = { tone: 'err', text: 'The upload didn’t go through. Please try again.' };
				return;
			}
			const putThumb = await fetch(data.thumb_upload_url, {
				method: 'PUT',
				headers: { 'content-type': 'image/webp' },
				body: thumb
			});
			if (!putThumb.ok) {
				uploadMsg = { tone: 'err', text: 'The upload didn’t go through. Please try again.' };
				return;
			}

			const { error: insertError } = await supabase.from('assets').insert({
				user_id: auth.kind === 'ready' ? auth.profile?.id : undefined,
				s3_key: data.s3_key,
				thumb_s3_key: data.thumb_s3_key,
				content_type: file.type,
				byte_size: file.size
			});
			if (insertError) {
				uploadMsg = { tone: 'err', text: 'Saved the image, but not the record. Please try again.' };
				return;
			}
			uploadMsg = { tone: 'ok', text: 'Added — thank you!' };
			void load();
		} catch {
			// Thumbnail encoding, network, or function failure — one message.
			uploadMsg = { tone: 'err', text: 'We couldn’t start that upload. Please try again.' };
		} finally {
			uploading = false;
		}
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
		<div class="actions">
			<button
				class="btn ghost"
				type="button"
				disabled={selectedIds.length === 0 || downloading}
				onclick={onDownload}
			>
				{downloading ? 'Preparing…' : 'Download'}
			</button>
			<button
				class="btn ghost danger"
				type="button"
				disabled={selectedIds.length === 0 || !canDeleteSelection || deleting}
				onclick={onDelete}
			>
				{deleting ? 'Deleting…' : 'Delete'}
			</button>
			{#if selecting}
				<span class="count">{selectedIds.length} selected</span>
			{/if}
			{#if downloadMsg}
				<span class="msg {downloadMsg.tone}">{downloadMsg.text}</span>
			{/if}
			{#if deleteMsg}
				<span class="msg {deleteMsg.tone}">{deleteMsg.text}</span>
			{/if}
		</div>
	</div>

	{#if loading}
		<p class="sub">Loading…</p>
	{:else if assets.length === 0}
		<p class="sub">No photos yet — be the first to share one.</p>
	{:else}
		<div class="gallery-grid {selecting ? 'selecting' : ''}">
			{#each assets as asset (asset.id)}
				<figure>
					{#if urls[asset.id]}
						<!-- Grid cell shows the thumbnail; the link opens the
						     full-size original in a new tab (knowledge/design/
						     gallery-thumbnails.md). -->
						<a href={urls[asset.id].url} target="_blank" rel="noopener">
							<img
								src={urls[asset.id].thumbUrl ?? urls[asset.id].url}
								alt={asset.caption ?? 'A shared photo'}
								loading="lazy"
							/>
						</a>
					{:else}
						<div class="placeholder" role="img" aria-label="Image unavailable"></div>
					{/if}
					<!-- Hover/focus reveals the checkbox; any active selection
					     keeps all of them visible (knowledge/design/
					     selection-actions.md). Disabled without a signed URL.
					     Selection drives both Download and Delete, so the label
					     names the action, not just the photo. -->
					<input
						type="checkbox"
						class="select"
						bind:group={selectedIds}
						value={asset.id}
						disabled={!urls[asset.id]}
						aria-label={asset.caption ? `Select ${asset.caption}` : 'Select this photo'}
					/>
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

	.actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-left: auto;
	}

	.actions .msg {
		margin-top: 0;
	}

	.count {
		font-size: 0.95rem;
		color: var(--muted);
		white-space: nowrap;
	}

	.gallery-grid figure {
		position: relative;
	}

	/* The checkbox is interactive even while hidden (keyboard focus and
	   touch taps both reach it); visibility is the effect of hover, an
	   active selection, or focus. */
	.select {
		position: absolute;
		top: 0.45rem;
		left: 0.45rem;
		z-index: 1;
		width: 1.25rem;
		height: 1.25rem;
		margin: 0;
		opacity: 0;
		transition: opacity 120ms ease;
		cursor: pointer;
	}

	.gallery-grid figure:hover .select,
	.gallery-grid.selecting .select,
	.select:focus-visible {
		opacity: 1;
	}
</style>
