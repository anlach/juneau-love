import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
	openAuthLink,
	generateLink,
	GUEST_EMAIL,
	BASE_URL,
	createUnconfirmedUser,
	confirmEmail,
	deleteAuthUser,
	deleteAssetsForUser,
	getAssetsForUser,
	getStorageObject,
	getUserRow,
	setUserStatus,
	REST_URL,
	anonKey,
	getAccessToken,
	waitFor
} from './helpers';

const created: string[] = [];
test.afterEach(async () => {
	for (const email of created.splice(0)) await deleteAuthUser(email);
});

// 1x1 transparent PNG — just big enough to be a real image for the
// client-side type/size checks.
const PNG_1X1 = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
	'base64'
);

/**
 * An approved, confirmed guest signs in through a magic link and reaches the
 * guest content. This is the happy path: link → session in the URL fragment →
 * app installs it → approval status gates the content open.
 */

test.describe('approved guest', () => {
	test('magic link signs the guest in and lands on the invitation', async ({ page }) => {
		await openAuthLink(page, GUEST_EMAIL, 'magiclink');

		// The login route hands a ready session to the invitation.
		await expect(page).toHaveURL('/');
		await expect(page.getByRole('heading', { name: /welcome, local guest/i })).toBeVisible();
		// Signed-in nav now offers the gallery (and no admin link for a guest).
		await expect(page.getByRole('navigation').getByRole('link', { name: 'Photos' })).toBeVisible();
		await expect(page.getByRole('navigation').getByRole('link', { name: 'Registrations' })).toHaveCount(0);
	});

	test('approved guest can open the gallery', async ({ page }) => {
		await openAuthLink(page, GUEST_EMAIL, 'magiclink');
		await expect(page).toHaveURL('/');

		await page.getByRole('navigation').getByRole('link', { name: 'Photos' }).click();
		await expect(page.getByRole('heading', { name: /photos/i })).toBeVisible();
		await expect(page.getByRole('button', { name: /add a photo/i })).toBeVisible();
		// No assets have been uploaded in the local stack → empty state.
		await expect(page.getByText(/no photos yet/i)).toBeVisible();
	});

	test('approved guest can open the things to do page', async ({ page }) => {
		await openAuthLink(page, GUEST_EMAIL, 'magiclink');
		await expect(page).toHaveURL('/');

		// Signed-in nav offers the guide alongside Photos.
		await page.getByRole('navigation').getByRole('link', { name: 'Things to Do' }).click();

		await expect(page).toHaveURL('/things-to-do');
		await expect(page.getByRole('heading', { name: /things to do in juneau/i })).toBeVisible();

		// The guide content renders: a trail, a museum, and the tide chart link.
		await expect(page.getByText('Nugget Falls Trail')).toBeVisible();
		await expect(page.getByText('Sealaska Heritage Institute')).toBeVisible();
		await expect(
			page.locator(
				'a[href="https://tidesandcurrents.noaa.gov/stationhome.html?id=9452210"]'
			)
		).toBeVisible();
	});

	test('things to do embeds the map and offers a download', async ({ page }) => {
		await openAuthLink(page, GUEST_EMAIL, 'magiclink');
		await expect(page).toHaveURL('/');

		await page.goto('/things-to-do');
		await expect(page.getByRole('heading', { name: /things to do in juneau/i })).toBeVisible();

		// The map is embedded as the static PDF, and the download link points
		// at the same file with the download attribute set.
		await expect(page.locator('iframe[src="/juneau-map.pdf"]')).toHaveCount(1);
		const download = page.getByRole('link', { name: /download/i });
		await expect(download).toHaveAttribute('href', '/juneau-map.pdf');
		await expect(download).toHaveAttribute('download');

		// The asset itself is served as a real PDF.
		const res = await page.request.get('/juneau-map.pdf');
		expect(res.status()).toBe(200);
		expect(res.headers()['content-type']).toContain('application/pdf');
	});

	test('guest cannot open the registrations page', async ({ page }) => {
		await openAuthLink(page, GUEST_EMAIL, 'magiclink');
		await expect(page).toHaveURL('/');

		await page.goto('/registrations');
		await expect(page.getByRole('heading', { name: /not available to you/i })).toBeVisible();
	});

	test('guest uploads a photo end-to-end against the local S3 stack', async ({ page }) => {
		// Local stack: the edge runtime has the storage S3 protocol configured
		// (config.toml [edge_runtime.secrets]), so a real upload works — the
		// presigned PUT and GET both go to 127.0.0.1:54321/storage/v1/s3.
		// Clean up afterwards so the empty-state test stays valid next run
		// (finally: runs even when an assertion below fails).
		try {
			await openAuthLink(page, GUEST_EMAIL, 'magiclink');
			await expect(page).toHaveURL('/');
			await page.getByRole('navigation').getByRole('link', { name: 'Photos' }).click();
			await expect(page.getByRole('heading', { name: /photos/i })).toBeVisible();

			// Capture the gallery's batched asset-url responses: the one that
			// carries the new row's signed thumbnail URL is the contract under
			// test ({ urls: [{ asset_id, url, thumb_url?, expires_at }] }).
			let thumbEntry: { asset_id: string; url: string; thumb_url: string } | undefined;
			page.on('response', (res) => {
				if (res.request().method() !== 'POST' || !res.url().includes('/functions/v1/asset-url'))
					return;
				void res
					.json()
					.then((body) => {
						const entry = (body?.urls ?? []).find((u) => typeof u.thumb_url === 'string');
						if (entry) thumbEntry = entry;
					})
					.catch(() => {});
			});

			const [fileChooser] = await Promise.all([
				page.waitForEvent('filechooser'),
				page.getByRole('button', { name: /add a photo/i }).click()
			]);
			await fileChooser.setFiles([{ name: 'e2e.png', mimeType: 'image/png', buffer: PNG_1X1 }]);

			// Success message, then the photo renders from the presigned GET URL.
			await expect(page.getByText(/added — thank you/i)).toBeVisible();
			await expect(page.getByRole('img', { name: /a shared photo/i })).toBeVisible();

			// The row carries both object keys: the original under
			// uploads/<user_id>/ and the client-generated thumbnail under
			// thumbs/<user_id>/…webp, with the original's type and size.
			const row = await getUserRow(GUEST_EMAIL);
			if (!row) throw new Error('guest user row missing');
			const assets = await getAssetsForUser(row.id);
			expect(assets).toHaveLength(1);
			expect(assets[0].s3_key).toMatch(new RegExp(`^uploads/${row.id}/`));
			expect(assets[0].thumb_s3_key).toMatch(new RegExp(`^thumbs/${row.id}/.+\\.webp$`));
			expect(assets[0].content_type).toBe('image/png');
			expect(assets[0].byte_size).toBe(PNG_1X1.length);

			// The thumbnail object exists in the private bucket and is a real
			// WebP (browser-downscaled), not a copy of the original PNG.
			const thumbObj = await getStorageObject(assets[0].thumb_s3_key!);
			expect(thumbObj.status).toBe(200);
			expect(thumbObj.headers.get('content-type')).toContain('image/webp');
			const bytes = new Uint8Array(await thumbObj.arrayBuffer());
			expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
			expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WEBP');

			// The grid renders the thumbnail: the <img> src is exactly the
			// thumb_url asset-url signed for the row — not the full-size url.
			const img = page.getByRole('img', { name: /a shared photo/i });
			await expect
				.poll(() => thumbEntry?.asset_id, { timeout: 10_000 })
				.toBe(assets[0].id);
			await expect(img).toHaveAttribute('src', thumbEntry!.thumb_url);
			expect(thumbEntry!.thumb_url).not.toBe(thumbEntry!.url);

			// The grid shows the thumbnail at its natural aspect ratio
			// (width-constrained, never stretched or cropped into a fixed
			// box): rendered ratio == the thumbnail's own ratio.
			const rect = await img.evaluate(
				(el) =>
					new Promise<{ w: number; h: number }>((resolve) => {
						const done = () => {
							const r = el.getBoundingClientRect();
							resolve({ w: r.width, h: r.height });
							};
						if (el.complete && el.naturalWidth > 0) done();
						else el.addEventListener('load', done, { once: true });
					})
			);
			const [natW, natH] = await img.evaluate(
				(el) => [el.naturalWidth, el.naturalHeight] as [number, number]
			);
			expect(natW).toBeGreaterThan(0);
			expect(rect.w / rect.h).toBeCloseTo(natW / natH, 1);
		} finally {
			const row = await getUserRow(GUEST_EMAIL);
			if (row) await deleteAssetsForUser(row.id);
		}
	});
});

/** A confirmed + approved guest (both gates), for direct-DB tests. */
async function makeApprovedUser(name: string): Promise<string> {
	const email = await createUnconfirmedUser(name);
	created.push(email);
	await confirmEmail(email); // gate 1 (email verification)
	await setUserStatus(email, 'approved'); // gate 2 (admin approval)
	return email;
}

/**
 * Gallery photo download: hovering a cell reveals a checkbox; selecting one
 * enables the Download button and keeps every checkbox visible; Download
 * yields the original file for a single selection, or one zip containing
 * every selected original for several.
 */
test.describe('photo download', () => {
	/** Upload one 1×1 PNG through the gallery UI and wait for it in the grid. */
	async function uploadPhoto(page: Page, name: string): Promise<void> {
		const [fileChooser] = await Promise.all([
			page.waitForEvent('filechooser'),
			page.getByRole('button', { name: /add a photo/i }).click()
		]);
		await fileChooser.setFiles([{ name, mimeType: 'image/png', buffer: PNG_1X1 }]);
		// Success message, then the photo renders from its presigned URL.
		await expect(page.getByText(/added — thank you/i)).toBeVisible();
		await expect(page.getByRole('img', { name: /a shared photo/i })).toBeVisible();
	}

	async function openGallery(page: Page): Promise<void> {
		await openAuthLink(page, GUEST_EMAIL, 'magiclink');
		await expect(page).toHaveURL('/');
		await page.getByRole('navigation').getByRole('link', { name: 'Photos' }).click();
		await expect(page.getByRole('heading', { name: /photos/i })).toBeVisible();
	}

	test('selecting one photo downloads the original file, not a zip', async ({
		page
	}) => {
		try {
			await openGallery(page);
			await uploadPhoto(page, 'e2e-single.png');

			const figure = page.locator('figure').first();
			const checkbox = figure.getByRole('checkbox');
			const download = page.getByRole('button', { name: 'Download' });

			// Nothing selected: Download is disabled and the checkbox is
			// hidden until the cell is hovered.
			await expect(download).toBeDisabled();
			await expect(checkbox).toHaveCSS('opacity', '0');

			// Hovering the cell reveals the checkbox; checking it selects the
			// photo and enables Download.
			await figure.hover();
			await expect(checkbox).toHaveCSS('opacity', '1');
			await checkbox.click();
			await expect(download).toBeEnabled();

			// Downloading the single selection saves the original bytes
			// directly — no zip wrapper.
			const [downloadEvent] = await Promise.all([
				page.waitForEvent('download'),
				download.click()
			]);
			expect(downloadEvent.suggestedFilename()).toMatch(/\.png$/);
			const bytes = await fs.readFile((await downloadEvent.path())!);
			expect(Buffer.compare(bytes, PNG_1X1)).toBe(0);
		} finally {
			const row = await getUserRow(GUEST_EMAIL);
			if (row) await deleteAssetsForUser(row.id);
		}
	});

	test('selecting several photos downloads one zip with every original inside', async ({
		page
	}) => {
		try {
			await openGallery(page);
			await uploadPhoto(page, 'e2e-first.png');
			await uploadPhoto(page, 'e2e-second.png');

			const figures = page.locator('figure');
			await expect(figures).toHaveCount(2);
			const first = figures.nth(0).getByRole('checkbox');
			const second = figures.nth(1).getByRole('checkbox');
			const download = page.getByRole('button', { name: 'Download' });

			await expect(download).toBeDisabled();

			// Hover reveals the first checkbox; selecting it keeps ALL
			// checkboxes visible, so the second can be checked without
			// hovering its cell.
			await figures.nth(0).hover();
			await first.click();
			await expect(second).toHaveCSS('opacity', '1');
			await second.click();
			await expect(download).toBeEnabled();

			// Downloading several selections saves one zip archive.
			const [downloadEvent] = await Promise.all([
				page.waitForEvent('download'),
				download.click()
			]);
			expect(downloadEvent.suggestedFilename()).toMatch(/\.zip$/);
			const zipPath = (await downloadEvent.path())!;
			expect((await fs.readFile(zipPath)).subarray(0, 4).toString()).toBe('PK\x03\x04');

			// The archive is a valid zip holding both originals, byte for byte.
			const dest = await fs.mkdtemp(path.join(os.tmpdir(), 'juneau-zip-'));
			execFileSync('python3', ['-m', 'zipfile', '-e', zipPath, dest]);
			const entries = (await fs.readdir(dest)).sort();
			expect(entries).toHaveLength(2);
			for (const entry of entries)
				expect(
					Buffer.compare(await fs.readFile(path.join(dest, entry)), PNG_1X1)
				).toBe(0);

			// Deselecting everything disables the button again.
			await second.click();
			await first.click();
			await expect(download).toBeDisabled();
		} finally {
			const row = await getUserRow(GUEST_EMAIL);
			if (row) await deleteAssetsForUser(row.id);
		}
	});
});

test.describe('guest_names view backstop', () => {
	/**
	 * The view is a SECURITY DEFINER read window over `users`, and the
	 * project's default privileges hand client roles full DML on it. DML
	 * through a definer view runs with the owner's privileges, bypassing
	 * `users` RLS — and `users` has no delete guard. The view must stay
	 * read-only for client roles: the DELETE below must 403 and the
	 * victim must survive (knowledge/platform/bugs.md, 2026-10-26 entry).
	 */
	test('an approved guest cannot delete another user through guest_names', async ({
		page
	}) => {
		// Both approved: the victim's row is in the view, and the attacker
		// passes the view's is_approved() caller gate.
		const victimEmail = await makeApprovedUser('Victor Vanished');
		const attackerEmail = await makeApprovedUser('Attacker Adele');
		const victim = await getUserRow(victimEmail);
		expect(victim?.status).toBe('approved');

		// The attacker signs in through the real magic-link flow, then
		// replays their own session against the Data API directly.
		await openAuthLink(page, attackerEmail, 'magiclink');
		await expect(page).toHaveURL('/');
		const token = await waitFor(() => getAccessToken(page));
		const headers = { apikey: anonKey(), Authorization: `Bearer ${token}` };

		// The feature works: the attacker can read the victim's name.
		const get = await fetch(
			`${REST_URL}/guest_names?id=eq.${victim!.id}&select=display_name`,
			{ headers }
		);
		expect(get.status).toBe(200);
		expect(await get.json()).toEqual([{ display_name: 'Victor Vanished' }]);

		// The attack: DELETE straight through the view.
		const del = await fetch(`${REST_URL}/guest_names?id=eq.${victim!.id}`, {
			method: 'DELETE',
			headers
		});
		expect(del.status).toBe(403);

		// The victim's account is intact.
		expect((await getUserRow(victimEmail))?.id).toBe(victim!.id);
	});
});

test.describe('rejection backstop', () => {
	test('a rejected user who follows an old link lands on the rejection screen', async ({
		page
	}) => {
		// GoTrue knows nothing of our status: a link minted before a rejection
		// still exchanges — RLS + the rejection screen are the backstop.
		const email = await createUnconfirmedUser('Rejected Rita');
		created.push(email);
		await confirmEmail(email);
		await setUserStatus(email, 'rejected');

		const link = await generateLink(email, 'magiclink', `${BASE_URL}/login`);
		await page.goto(link, { waitUntil: 'domcontentloaded' });
		await expect(page).toHaveURL('/');
		await expect(page.getByText(/hasn.t been approved this time/i)).toBeVisible();
		await expect(page.getByRole('link', { name: 'Photos' })).toHaveCount(0);
	});
});
