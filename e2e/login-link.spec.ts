import { test, expect } from '@playwright/test';
import {
	GUEST_EMAIL,
	consumeLink,
	createUnconfirmedUser,
	deleteAuthUser,
	generateLink,
	invokeFunction,
	setLoginLinkCooldown,
	BASE_URL
} from './helpers';

/**
 * The "sign in" action (send-login-link) and the one-shot magic-link contract.
 *
 * send-login-link is publicly invokable and eligibility-gated: it only emails
 * a link to a registered, approved user (with a cooldown). The link itself is
 * a one-shot GoTrue magiclink — the second use is rejected.
 */

const created: string[] = [];
test.afterEach(async () => {
	for (const email of created.splice(0)) await deleteAuthUser(email);
});

test.describe('send-login-link eligibility', () => {
	test('approves only a registered, approved user', async () => {
		// Approved user → sent (clear any prior cooldown first).
		await setLoginLinkCooldown(GUEST_EMAIL, null);
		const ok = await invokeFunction('send-login-link', { email: GUEST_EMAIL });
		expect(ok.status).toBe(200);
		expect(ok.data.sent).toBe(true);

		// Pending user → not approved, no link.
		const pendingEmail = await createUnconfirmedUser('Hold Please');
		created.push(pendingEmail);
		const pending = await invokeFunction('send-login-link', { email: pendingEmail });
		expect(pending.status).toBe(200);
		expect(pending.data).toMatchObject({ sent: false, reason: 'not_approved' });

		// Unknown email → not found.
		const unknown = await invokeFunction('send-login-link', {
			email: 'ghost-who-does-not-exist@local.dev'
		});
		expect(unknown.status).toBe(200);
		expect(unknown.data).toMatchObject({ sent: false, reason: 'not_found' });
	});
});

test.describe('sign-in page messaging', () => {
	test('approved user is told a link is on its way', async ({ page }) => {
		await setLoginLinkCooldown(GUEST_EMAIL, null);
		await page.goto('/login');
		await page.getByLabel('Email').fill(GUEST_EMAIL);
		await page.getByRole('button', { name: /email me a link/i }).click();
		await expect(page.getByRole('status')).toContainText(/on its way/i);
	});

	test('unregistered email is told to register', async ({ page }) => {
		await page.goto('/login');
		await page.getByLabel('Email').fill('nobody-here@local.dev');
		await page.getByRole('button', { name: /email me a link/i }).click();
		await expect(page.getByRole('alert')).toContainText(/isn.t registered yet/i);
	});

	test('pending user is told they are waiting on approval', async ({ page }) => {
		const pendingEmail = await createUnconfirmedUser('Waiting Wanda');
		created.push(pendingEmail);

		await page.goto('/login');
		await page.getByLabel('Email').fill(pendingEmail);
		await page.getByRole('button', { name: /email me a link/i }).click();
		await expect(page.getByRole('alert')).toContainText(/hasn.t been approved yet/i);
	});
});

test.describe('cooldown', () => {
	test('resending within the 10-minute window is refused (429)', async ({ page }) => {
		await setLoginLinkCooldown(GUEST_EMAIL, new Date().toISOString());

		const r = await invokeFunction('send-login-link', { email: GUEST_EMAIL });
		expect(r.status).toBe(429);
		expect(r.data.retry_after_seconds).toBeGreaterThan(0);

		// The sign-in page turns the 429 into a "sent recently" message.
		await page.goto('/login');
		await page.getByLabel('Email').fill(GUEST_EMAIL);
		await page.getByRole('button', { name: /email me a link/i }).click();
		await expect(page.getByRole('alert')).toContainText(/sent one of these recently/i);

		await setLoginLinkCooldown(GUEST_EMAIL, null); // leave the seed user clean
	});
});

test.describe('one-shot magic link', () => {
	test('a used link is rejected and signs nobody in', async ({ page }) => {
		const link = await generateLink(GUEST_EMAIL, 'magiclink', `${BASE_URL}/login`);
		await consumeLink(link); // consume the one-shot token out-of-band

		// A fresh browser (no stored session) follows the now-dead link.
		await page.goto(link, { waitUntil: 'domcontentloaded' });
		await expect(page).toHaveURL(/\/login/);
		await expect(page.getByRole('alert')).toContainText(/already been used or has expired/i);
		// Not signed in: the signed-out nav, not the guest nav.
		await expect(page.getByRole('navigation').getByRole('link', { name: 'Photos' })).toHaveCount(0);
	});
});
