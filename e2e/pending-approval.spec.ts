import { test, expect } from '@playwright/test';
import { createUnconfirmedUser, openAuthLink, deleteAuthUser, getUserRow } from './helpers';

/**
 * Gate 1 (email confirmation) and the "awaiting approval" state.
 *
 * The guest is created unconfirmed, then confirms their email through a real
 * confirmation link in the browser. Confirming installs a session (so the
 * browser is signed in) but leaves status 'pending' — so the app shows the
 * awaiting-approval screen, not the invitation, and the gallery stays gated.
 */

const created: string[] = [];
test.afterEach(async () => {
	for (const email of created.splice(0)) await deleteAuthUser(email);
});

test.describe('pending registration', () => {
	test('confirming email signs the guest in but keeps them awaiting approval', async ({ page }) => {
		const email = await createUnconfirmedUser('Awaiting Alice');
		created.push(email);

		// Fresh unconfirmed user: a `users` row exists in 'pending'.
		const before = await getUserRow(email);
		expect(before?.status).toBe('pending');
		expect(before?.email_confirmed_at).toBeNull();

		await openAuthLink(page, email, 'signup');

		// Confirmation lands the guest home, still pending.
		await expect(page).toHaveURL('/');
		await expect(page.getByText(/you're on the list/i)).toBeVisible();
		await expect(page.getByRole('button', { name: /check status/i })).toBeVisible();

		// The DB row is now confirmed but still pending (the approval gate holds).
		const after = await getUserRow(email);
		expect(after?.email_confirmed_at).not.toBeNull();
		expect(after?.status).toBe('pending');
	});

	test('pending guest is blocked from the gallery', async ({ page }) => {
		const email = await createUnconfirmedUser('Awaiting Bob');
		created.push(email);

		await openAuthLink(page, email, 'signup');
		await expect(page).toHaveURL('/');
		await expect(page.getByText(/you're on the list/i)).toBeVisible();

		await page.goto('/gallery');
		// The pending screen, not the photos.
		await expect(page.getByText(/you're on the list/i)).toBeVisible();
		await expect(page.getByRole('heading', { name: /photos/i })).toHaveCount(0);
	});
});
