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

			const [fileChooser] = await Promise.all([
				page.waitForEvent('filechooser'),
				page.getByRole('button', { name: /add a photo/i }).click()
			]);
			await fileChooser.setFiles([{ name: 'e2e.png', mimeType: 'image/png', buffer: PNG_1X1 }]);

			// Success message, then the photo renders from the presigned GET URL.
			await expect(page.getByText(/added — thank you/i)).toBeVisible();
			await expect(page.getByRole('img', { name: /a shared photo/i })).toBeVisible();
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
