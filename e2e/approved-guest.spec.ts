import { test, expect } from '@playwright/test';
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
	setUserStatus
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
			await expect
				.poll(() => thumbEntry?.asset_id, { timeout: 10_000 })
				.toBe(assets[0].id);
			await expect(page.getByRole('img', { name: /a shared photo/i })).toHaveAttribute(
				'src',
				thumbEntry!.thumb_url
			);
			expect(thumbEntry!.thumb_url).not.toBe(thumbEntry!.url);
		} finally {
			const row = await getUserRow(GUEST_EMAIL);
			if (row) await deleteAssetsForUser(row.id);
		}
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
