import { test, expect } from '@playwright/test';
import {
	GUEST_EMAIL,
	confirmEmail,
	createUnconfirmedUser,
	deleteAuthUser,
	openAuthLink,
	setUserStatus
} from './helpers';

/**
 * /whale-watching: the guest-facing info page for the whale watch on
 * Friday, June 18, 2027 — the day before the wedding. Approval-gated
 * like all guest content (the gating is UX; the page carries no
 * sensitive data — knowledge/stories/whale-watch.md). The page's RSVP
 * button points at the shared RSVP page, where the whale-watch count is
 * collected (e2e/rsvp.spec.ts).
 */

const created: string[] = [];
test.afterEach(async () => {
	for (const email of created.splice(0)) await deleteAuthUser(email);
});

test.describe('whale watching', () => {
	test('an approved guest sees the plan from the nav', async ({ page }) => {
		await openAuthLink(page, GUEST_EMAIL, 'magiclink');
		await expect(page).toHaveURL('/');

		// The nav offers the page next to Photos and Things to Do.
		const nav = page.getByRole('navigation');
		await expect(nav.getByRole('link', { name: 'Whale Watch' })).toBeVisible();
		await nav.getByRole('link', { name: 'Whale Watch' }).click();
		await expect(page).toHaveURL('/whale-watching');

		// The plan: the date, the three times, both ends at Statter
		// Harbor, and the headroom note.
		await expect(page.getByRole('heading', { name: 'Whale Watch' })).toBeVisible();
		await expect(page.getByText(/friday, june 18, 2027/i)).toBeVisible();
		await expect(page.getByText(/2:45 pm — meet at statter harbor/i)).toBeVisible();
		await expect(page.getByText(/3:00 pm — departure/i)).toBeVisible();
		await expect(page.getByText(/6:00 pm — back at statter harbor/i)).toBeVisible();
		await expect(page.getByText(/up to 120/i)).toBeVisible();

		// The RSVP button leads to the shared RSVP page.
		const rsvp = page.getByRole('link', { name: /rsvp/i });
		await expect(rsvp).toHaveAttribute('href', '/rsvp');
	});

	test('an anonymous visitor sees a sign-in prompt, not the plan', async ({ page }) => {
		await page.goto('/whale-watching');
		await expect(page.getByText(/whale watch details wait on the inside/i)).toBeVisible();
		await expect(page.locator('.card').getByRole('link', { name: 'Sign in' })).toBeVisible();
		await expect(page.getByText(/statter harbor/i)).toHaveCount(0);
	});

	test('a pending guest sees the awaiting screen, not the plan', async ({ page }) => {
		const email = await createUnconfirmedUser('Snooping Stella');
		created.push(email);
		await confirmEmail(email); // confirmed, still pending
		await openAuthLink(page, email, 'magiclink');
		// Let the one-shot link install the session before navigating on.
		await expect(page).toHaveURL('/');

		await page.goto('/whale-watching');
		await expect(page.getByText(/you.re on the list/i)).toBeVisible();
		await expect(page.getByText(/statter harbor/i)).toHaveCount(0);
	});

	test('a rejected guest sees the rejection screen, not the plan', async ({ page }) => {
		const email = await createUnconfirmedUser('Turned Away Tess');
		created.push(email);
		await confirmEmail(email);
		await setUserStatus(email, 'rejected');
		await openAuthLink(page, email, 'magiclink');
		// Let the one-shot link install the session before navigating on.
		await expect(page).toHaveURL('/');

		await page.goto('/whale-watching');
		await expect(page.getByText(/hasn.t been approved this time/i)).toBeVisible();
		await expect(page.getByText(/statter harbor/i)).toHaveCount(0);
	});
});
