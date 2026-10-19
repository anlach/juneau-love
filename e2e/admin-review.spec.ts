import { test, expect } from '@playwright/test';
import {
	ADMIN_EMAIL,
	confirmEmail,
	createUnconfirmedUser,
	deleteAuthUser,
	getRoleNames,
	getUserRow,
	openAuthLink,
	waitFor
} from './helpers';

/**
 * The admin registrations page: RBAC-gated list, and the approve/reject
 * actions that drive the approval state machine (and the guest-role sync
 * trigger) through the registration-decision edge function.
 */

const created: string[] = [];
test.afterEach(async () => {
	for (const email of created.splice(0)) await deleteAuthUser(email);
});

async function makeConfirmedPendingUser(name: string): Promise<string> {
	const email = await createUnconfirmedUser(name);
	created.push(email);
	await confirmEmail(email); // gate 1 done → approvable
	const row = await getUserRow(email);
	expect(row?.status).toBe('pending');
	expect(row?.email_confirmed_at).not.toBeNull();
	return email;
}

async function signInAsAdmin(page: import('@playwright/test').Page): Promise<void> {
	await openAuthLink(page, ADMIN_EMAIL, 'magiclink');
	await expect(page).toHaveURL('/');
	await page.goto('/registrations');
	await expect(page.getByRole('heading', { name: /registrations/i })).toBeVisible();
}

test.describe('admin registration review', () => {
	test('admin approves a confirmed pending registration', async ({ page }) => {
		const email = await makeConfirmedPendingUser('Carol Approve');
		await signInAsAdmin(page);

		const row = page.locator('tr', { hasText: email });
		await expect(row).toBeVisible();
		await row.getByRole('button', { name: 'Approve' }).click();

		// UI feedback + the row's badge flip to approved.
		await expect(page.getByRole('status')).toContainText(/approved/i);
		await expect(row.locator('.badge')).toHaveText('approved');

		// The write went through: status approved AND the guest role granted.
		const after = await waitFor(async () => {
			const r = await getUserRow(email);
			return r && r.status === 'approved' ? r : null;
		});
		expect(await getRoleNames(after.id)).toContain('guest');
	});

	test('admin rejects a confirmed pending registration', async ({ page }) => {
		const email = await makeConfirmedPendingUser('Dave Reject');
		await signInAsAdmin(page);

		const row = page.locator('tr', { hasText: email });
		await expect(row).toBeVisible();
		await row.getByRole('button', { name: 'Reject' }).click();

		await expect(page.getByRole('status')).toContainText(/rejected/i);
		await expect(row.locator('.badge')).toHaveText('rejected');

		const after = await waitFor(async () => {
			const r = await getUserRow(email);
			return r && r.status === 'rejected' ? r : null;
		});
		expect(await getRoleNames(after.id)).not.toContain('guest');
	});
});
