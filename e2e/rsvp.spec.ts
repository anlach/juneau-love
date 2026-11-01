import { test, expect, type Page } from '@playwright/test';
import {
	GUEST_EMAIL,
	anonKey,
	confirmEmail,
	createUnconfirmedUser,
	deleteAuthUser,
	getAccessToken,
	getUserRow,
	openAuthLink,
	REST_URL,
	setUserStatus,
	waitFor
} from './helpers';

/**
 * RSVP: each approved guest tells us how many people in their party will
 * attend the wedding.
 *
 * The landing card's primary action is the RSVP page — it replaces the old
 * "See the photos" card link (Photos stays in the nav). /rsvp is an
 * approval-gated self-update of `users.party_size`, the second column the
 * guard trigger lets a user write (knowledge/db/users.md): the DB backstop
 * is the CHECK range plus the guard's writer-class rules. The admin's
 * registrations table shows the per-row number and a headcount total
 * (e2e/admin-review.spec.ts).
 */

const created: string[] = [];
test.afterEach(async () => {
	for (const email of created.splice(0)) await deleteAuthUser(email);
});

/** A confirmed + approved guest (both gates), for direct-DB tests. */
async function makeApprovedUser(name: string): Promise<string> {
	const email = await createUnconfirmedUser(name);
	created.push(email);
	await confirmEmail(email); // gate 1 (email verification)
	await setUserStatus(email, 'approved'); // gate 2 (admin approval)
	return email;
}

async function signIn(page: Page, email: string): Promise<void> {
	await openAuthLink(page, email, 'magiclink');
	await expect(page).toHaveURL('/');
}

test.describe('rsvp', () => {
	test('the landing page links to the rsvp page instead of the photos page', async ({
		page
	}) => {
		await signIn(page, GUEST_EMAIL);
		await expect(page.getByRole('heading', { name: /welcome, local guest/i })).toBeVisible();

		// The approved card's primary action is now the RSVP page…
		const rsvp = page.getByRole('link', { name: /rsvp/i });
		await expect(rsvp).toBeVisible();
		await expect(rsvp).toHaveAttribute('href', '/rsvp');
		// …and the old "See the photos" card link is gone…
		await expect(page.getByRole('link', { name: /see the photos/i })).toHaveCount(0);
		// …while Photos stays in the nav.
		await expect(page.getByRole('navigation').getByRole('link', { name: 'Photos' })).toBeVisible();
	});

	test('an approved guest sets the number of people attending', async ({ page }) => {
		const email = await makeApprovedUser('Rsvp Rex');
		await signIn(page, email);

		// The landing card links straight to the form.
		await page.getByRole('link', { name: /rsvp/i }).click();
		await expect(page).toHaveURL('/rsvp');
		await expect(page.getByRole('heading', { name: /rsvp/i })).toBeVisible();

		// No RSVP yet: the field starts empty.
		const count = page.getByLabel(/how many/i);
		await expect(count).toHaveValue('');

		await count.fill('3');
		await page.getByRole('button', { name: /save rsvp/i }).click();
		await expect(page.getByText(/thank you/i)).toBeVisible();

		// The DB row carries the number.
		await expect
			.poll(async () => (await getUserRow(email))?.party_size)
			.toBe(3);
	});

	test('the form pre-fills the saved number and saves a change', async ({ page }) => {
		const email = await makeApprovedUser('Prefill Pam');
		await signIn(page, email);
		await page.goto('/rsvp');

		const count = page.getByLabel(/how many/i);
		await count.fill('5');
		await page.getByRole('button', { name: /save rsvp/i }).click();
		await expect(page.getByText(/thank you/i)).toBeVisible();

		// A fresh load pre-fills from the saved row.
		await page.goto('/rsvp');
		await expect(count).toHaveValue('5');

		// Changing it again saves the new value.
		await count.fill('2');
		await page.getByRole('button', { name: /save rsvp/i }).click();
		await expect(page.getByText(/thank you/i)).toBeVisible();
		await expect
			.poll(async () => (await getUserRow(email))?.party_size)
			.toBe(2);
	});

	test('an out-of-range or empty count is refused and the row keeps its value', async ({
		page
	}) => {
		const email = await makeApprovedUser('Cap Casey');
		await signIn(page, email);
		await page.goto('/rsvp');

		const count = page.getByLabel(/how many/i);

		// Above the party cap: friendly error, nothing written.
		await count.fill('9');
		await page.getByRole('button', { name: /save rsvp/i }).click();
		await expect(page.getByText(/0 to 8/i)).toBeVisible();
		expect((await getUserRow(email))?.party_size).toBeNull();

		// A below-cap value is saved, then an empty save is refused and the
		// saved value stands.
		await count.fill('1');
		await page.getByRole('button', { name: /save rsvp/i }).click();
		await expect(page.getByText(/thank you/i)).toBeVisible();
		expect((await getUserRow(email))?.party_size).toBe(1);

		await count.fill('');
		await page.getByRole('button', { name: /save rsvp/i }).click();
		await expect(page.getByText(/0 to 8/i)).toBeVisible();
		expect((await getUserRow(email))?.party_size).toBe(1);
	});

	test('a pending guest sees the awaiting screen, not the rsvp form', async ({ page }) => {
		const email = await createUnconfirmedUser('Waiting Willa');
		created.push(email);
		await confirmEmail(email); // confirmed, still pending
		await signIn(page, email);

		await page.goto('/rsvp');
		await expect(page.getByText(/you.re on the list/i)).toBeVisible();
		await expect(page.getByLabel(/how many/i)).toHaveCount(0);
	});

	test('a rejected guest sees the rejection screen, not the rsvp form', async ({ page }) => {
		const email = await createUnconfirmedUser('Declined Dana');
		created.push(email);
		await confirmEmail(email);
		await setUserStatus(email, 'rejected');
		await signIn(page, email);

		await page.goto('/rsvp');
		await expect(page.getByText(/hasn.t been approved this time/i)).toBeVisible();
		await expect(page.getByLabel(/how many/i)).toHaveCount(0);
	});

	test('hand-crafted writes: own party_size in range only, no other columns, no other rows', async ({
		page
	}) => {
		const email = await makeApprovedUser('Guard Gina');
		await signIn(page, email);
		const row = await getUserRow(email);
		if (!row) throw new Error('user row missing');
		const token = await waitFor(() => getAccessToken(page));
		const headers = {
			apikey: anonKey(),
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json'
		};

		// In-range party_size on the own row: the self-write the page makes.
		const ok = await fetch(`${REST_URL}/users?id=eq.${row.id}`, {
			method: 'PATCH',
			headers,
			body: JSON.stringify({ party_size: 4 })
		});
		expect([200, 204]).toContain(ok.status);
		expect((await getUserRow(email))?.party_size).toBe(4);

		// Out of range: refused (the CHECK constraint), row unchanged.
		const outOfRange = await fetch(`${REST_URL}/users?id=eq.${row.id}`, {
			method: 'PATCH',
			headers,
			body: JSON.stringify({ party_size: 9 })
		});
		expect(outOfRange.status).toBe(400);
		expect((await getUserRow(email))?.party_size).toBe(4);

		// The guard still locks down every other column for the user.
		const sneaky = await fetch(`${REST_URL}/users?id=eq.${row.id}`, {
			method: 'PATCH',
			headers,
			body: JSON.stringify({ email_confirmed_at: '2020-01-01T00:00:00Z' })
		});
		expect(sneaky.status).toBe(400);

		// Another user's row is outside the write policy: 0 rows, no error.
		const otherEmail = await makeApprovedUser('Other Otto');
		const other = await getUserRow(otherEmail);
		if (!other) throw new Error('other user row missing');
		const otherPatch = await fetch(`${REST_URL}/users?id=eq.${other.id}`, {
			method: 'PATCH',
			headers,
			body: JSON.stringify({ party_size: 6 })
		});
		expect([200, 204]).toContain(otherPatch.status);
		expect((await getUserRow(otherEmail))?.party_size).toBeNull();
	});
});
