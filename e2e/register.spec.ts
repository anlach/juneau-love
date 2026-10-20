import { test, expect } from '@playwright/test';
import { deleteAuthUser, getUserRow } from './helpers';

/**
 * Registration through the real form. The browser submits name + email;
 * GoTrue's magic-link endpoint (POST /auth/v1/otp) creates the account and
 * the DB row lands in 'pending'. Also covers the "already registered"
 * path (the form probes with shouldCreateUser: false first).
 */

let email = '';
test.afterEach(async () => {
	if (email) {
		await deleteAuthUser(email);
		email = '';
	}
});

test.describe('register', () => {
	test('form signs a new guest up (pending, display name stored)', async ({ page }) => {
		email = `e2e-register-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@local.dev`;
		await page.goto('/register');
		await page.getByLabel('Your name').fill('Register Rita');
		await page.getByLabel('Email').fill(email);
		await page.getByRole('button', { name: /request access/i }).click();

		// Step 1 of 2 done: the session-independent "check your email" screen.
		await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible();
		await expect(page.getByText(email)).toBeVisible();

		// The account exists, unapproved, with the display name.
		const row = await getUserRow(email);
		expect(row?.status).toBe('pending');
		expect(row?.display_name).toBe('Register Rita');
	});

	test('re-registering an existing email points to sign-in', async ({ page }) => {
		email = `e2e-register-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@local.dev`;
		// First register the email through the form.
		await page.goto('/register');
		await page.getByLabel('Your name').fill('Register Rita');
		await page.getByLabel('Email').fill(email);
		await page.getByRole('button', { name: /request access/i }).click();
		await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible();

		// Same email again: the form refuses and points to the sign-in page.
		await page.goto('/register');
		await page.getByLabel('Your name').fill('Register Rita');
		await page.getByLabel('Email').fill(email);
		await page.getByRole('button', { name: /request access/i }).click();
		await expect(page.getByText(/already exists — sign in/i)).toBeVisible();
	});
});
