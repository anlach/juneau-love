import { test, expect } from '@playwright/test';

/**
 * Public, signed-out surface. No Supabase session is involved, so these are
 * fast and deterministic.
 */

test.describe('anonymous visitor', () => {
	test('landing shows the public invitation and signed-out nav', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { name: /you're invited/i })).toBeVisible();
		// Signed-out nav offers sign in + register, nothing else.
		await expect(page.getByRole('navigation').getByRole('link', { name: 'Sign in' })).toBeVisible();
		await expect(page.getByRole('navigation').getByRole('link', { name: 'Register' })).toBeVisible();
		// No guest-only entry points leak to anonymous.
		await expect(page.getByRole('link', { name: 'Photos' })).toHaveCount(0);
	});

	test('gallery is gated behind sign-in', async ({ page }) => {
		await page.goto('/gallery');
		await expect(page.getByRole('heading', { name: /a private photo corner/i })).toBeVisible();
	});

	test('registrations is gated behind sign-in', async ({ page }) => {
		await page.goto('/registrations');
		await expect(page.getByRole('heading', { name: /sign in to continue/i })).toBeVisible();
	});

	test('login form validates email before sending', async ({ page }) => {
		await page.goto('/login');
		await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
		await page.getByLabel('Email').fill('not-an-email');
		await page.getByRole('button', { name: /email me a link/i }).click();
		await expect(page.getByText(/doesn’t look quite right/i)).toBeVisible();
	});

	test('register form validates name and email', async ({ page }) => {
		await page.goto('/register');
		await expect(page.getByRole('heading', { name: /register/i })).toBeVisible();

		// Empty name.
		await page.getByLabel('Email').fill('someone@example.com');
		await page.getByRole('button', { name: /request access/i }).click();
		await expect(page.getByText(/please tell us your name/i)).toBeVisible();

		// Bad email.
		await page.getByLabel('Your name').fill('Alex Doe');
		await page.getByLabel('Email').fill('nope');
		await page.getByRole('button', { name: /request access/i }).click();
		await expect(page.getByText(/doesn’t look quite right/i)).toBeVisible();
	});
});
