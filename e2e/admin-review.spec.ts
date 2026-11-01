import { test, expect } from '@playwright/test';
import {
	ADMIN_EMAIL,
	confirmEmail,
	createUnconfirmedUser,
	deleteAuthUser,
	getApprovedPartyTotal,
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

	test('approve is disabled until the email is confirmed', async ({ page }) => {
		// Unconfirmed pending user: the verify-then-approve rule surfaces as a
		// disabled Approve button (Reject stays available).
		const email = await createUnconfirmedUser('Unverified Una');
		created.push(email);
		await signInAsAdmin(page);

		const row = page.locator('tr', { hasText: email });
		await expect(row).toBeVisible();
		await expect(row.getByRole('button', { name: 'Approve' })).toBeDisabled();
		await expect(row.getByRole('button', { name: 'Reject' })).toBeEnabled();
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

	// The admin notification email deep-links into this page
	// (?approve=<id> / ?reject=<id>): the link is a confirm prompt only —
	// the decision still goes through registration-decision.
	test('approve deep link prompts and approves', async ({ page }) => {
		const email = await makeConfirmedPendingUser('Eve DeepLink');
		created.push(email);
		const before = await getUserRow(email);
		if (!before) throw new Error(`missing user row for ${email}`);
		await signInAsAdmin(page);

		await page.goto(`/registrations?approve=${before.id}`);
		await expect(page.getByRole('heading', { name: /registrations/i })).toBeVisible();

		// The banner names the guest before any state change.
		const banner = page.locator('.decision-banner');
		await expect(banner).toContainText(/approve eve deeplink/i);
		await expect(banner).toContainText(email);

		await banner.getByRole('button', { name: 'Approve' }).click();

		// Banner consumed, row flipped, deep-link param stripped.
		await expect(banner).toHaveCount(0);
		await expect(page.getByRole('status')).toContainText(/approved/i);
		await expect(page.locator('tr', { hasText: email }).locator('.badge')).toHaveText('approved');
		expect(page.url()).not.toContain('approve=');

		const after = await waitFor(async () => {
			const r = await getUserRow(email);
			return r && r.status === 'approved' ? r : null;
		});
		expect(await getRoleNames(after.id)).toContain('guest');
	});

	test('reject deep link prompts and rejects', async ({ page }) => {
		const email = await makeConfirmedPendingUser('Frank DeepLink');
		created.push(email);
		const before = await getUserRow(email);
		if (!before) throw new Error(`missing user row for ${email}`);
		await signInAsAdmin(page);

		await page.goto(`/registrations?reject=${before.id}`);
		const banner = page.locator('.decision-banner');
		await expect(banner).toContainText(/reject frank deeplink/i);

		await banner.getByRole('button', { name: 'Reject' }).click();

		await expect(banner).toHaveCount(0);
		await expect(page.locator('tr', { hasText: email }).locator('.badge')).toHaveText('rejected');
		expect(page.url()).not.toContain('reject=');
	});

	test('deep link for an unknown registration shows a notice', async ({ page }) => {
		await signInAsAdmin(page);

		await page.goto('/registrations?approve=99999999-9999-9999-9999-999999999999');
		const banner = page.locator('.decision-banner');
		await expect(banner).toContainText(/couldn.t find that registration/i);
		await banner.getByRole('button', { name: 'Got it' }).click();
		await expect(banner).toHaveCount(0);
	});

	/**
	 * Headcount: the table shows each guest's party size (the RSVP number;
	 * the column's null default renders as an em dash until they've
	 * rsvp'd), and a total over APPROVED rows in which an unset (null)
	 * party size counts for zero — rejecting a guest keeps their number in
	 * the row but drops it from the total.
	 */
	test('the table shows party sizes and a headcount total of approved rsvps', async ({
		page
	}) => {
		const email = await makeConfirmedPendingUser('Headcount Hattie');
		await signInAsAdmin(page);

		// Approve Hattie so she can rsvp.
		let row = page.locator('tr', { hasText: email });
		await expect(row).toBeVisible();
		await row.getByRole('button', { name: 'Approve' }).click();
		await expect(page.getByRole('status')).toContainText(/approved/i);
		await expect(row.locator('.badge')).toHaveText('approved');

		// She hasn't rsvp'd yet: her party cell is null (the column default)
		// and the total counts her for zero — the baseline.
		const baseline = await getApprovedPartyTotal();
		await expect(row.getByRole('cell', { name: '—' })).toBeVisible();
		await expect(
			page.getByText(new RegExp(`expected headcount: ${baseline}`, 'i'))
		).toBeVisible();

		// She RSVPs for four through the guest page (the landing card link).
		await openAuthLink(page, email, 'magiclink');
		await expect(page).toHaveURL('/');
		await page.getByRole('link', { name: /rsvp/i }).click();
		await expect(page).toHaveURL('/rsvp');
		await page.getByLabel(/how many/i).fill('4');
		await page.getByRole('button', { name: /save rsvp/i }).click();
		await expect(page.getByText(/thank you/i)).toBeVisible();
		await expect.poll(async () => (await getUserRow(email))?.party_size).toBe(4);

		// …and the admin's table shows her number with a matching total.
		await signInAsAdmin(page);
		await expect(page.getByRole('columnheader', { name: 'Party' })).toBeVisible();
		row = page.locator('tr', { hasText: email });
		await expect(row).toBeVisible();
		const partyCell = row.getByRole('cell').filter({ hasText: /^4$/ });
		await expect(partyCell).toBeVisible();

		const total = await getApprovedPartyTotal();
		expect(total).toBe(baseline + 4);
		await expect(
			page.getByText(new RegExp(`expected headcount: ${total}`, 'i'))
		).toBeVisible();

		// Rejecting her keeps her number in the table but drops it from the
		// total (only approved rows count) — back to the baseline.
		await row.getByRole('button', { name: 'Reject' }).click();
		await expect(page.getByRole('status')).toContainText(/rejected/i);
		await expect(row.locator('.badge')).toHaveText('rejected');
		await expect(partyCell).toBeVisible();

		const totalAfter = await getApprovedPartyTotal();
		expect(totalAfter).toBe(baseline);
		await expect(
			page.getByText(new RegExp(`expected headcount: ${totalAfter}`, 'i'))
		).toBeVisible();
	});
});
