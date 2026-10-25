import { test, expect } from '@playwright/test';
import {
	openAuthLink,
	createUnconfirmedUser,
	confirmEmail,
	setUserStatus,
	deleteAuthUser,
	getUserRow
} from './helpers';

/**
 * Changing the display name, and the signed-in account menu that reaches it.
 *
 * The header's bare "Sign out" button becomes a menu button (a stack of
 * three lines) whose dropdown offers "Change Name" and "Sign Out".
 * /change-name looks like the registration card and saves a self-update of
 * `users.display_name` — the only column the guard trigger lets a user
 * change (knowledge/db/users.md), so the header name and the DB row must
 * both follow.
 */

const created: string[] = [];
test.afterEach(async () => {
	for (const email of created.splice(0)) await deleteAuthUser(email);
});

async function makeApprovedUser(name: string): Promise<string> {
	const email = await createUnconfirmedUser(name);
	created.push(email);
	await confirmEmail(email); // gate 1 (email verification)
	await setUserStatus(email, 'approved'); // gate 2 (admin approval)
	return email;
}

async function signIn(page: import('@playwright/test').Page, email: string): Promise<void> {
	await openAuthLink(page, email, 'magiclink');
	await expect(page).toHaveURL('/');
}

test.describe('change display name', () => {
	test('signed-in nav offers an account menu, not a bare sign out', async ({ page }) => {
		const email = await makeApprovedUser('Menu Mia');
		await signIn(page, email);

		// The bare "Sign out" text button is gone...
		await expect(
			page.getByRole('navigation').getByRole('button', { name: 'Sign out' })
		).toHaveCount(0);
		// ...the name is still shown...
		await expect(page.getByRole('navigation').getByText('Menu Mia')).toBeVisible();
		// ...and the menu button (a stack of three lines) opens a dropdown
		// offering Change Name and Sign Out.
		const menuButton = page.getByRole('navigation').getByRole('button', { name: 'Menu' });
		await expect(menuButton).toBeVisible();
		await menuButton.click();
		await expect(page.getByRole('menuitem', { name: 'Change Name' })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: 'Sign Out' })).toBeVisible();

		// Clicking away closes the menu.
		await page.getByRole('link', { name: /juneau\.love/i }).click();
		await expect(page.getByRole('menuitem', { name: 'Change Name' })).toHaveCount(0);
	});

	test('guest changes their display name from the menu page', async ({ page }) => {
		const email = await makeApprovedUser('Old Name Olly');
		await signIn(page, email);

		// Menu → Change Name.
		await page.getByRole('navigation').getByRole('button', { name: 'Menu' }).click();
		await page.getByRole('menuitem', { name: 'Change Name' }).click();
		await expect(page).toHaveURL(/\/change-name$/);
		await expect(page.getByRole('heading', { name: /change name/i })).toBeVisible();

		// The form is prefilled with the current name.
		const nameField = page.getByLabel('Your name');
		await expect(nameField).toHaveValue('Old Name Olly');

		// A new name is saved; the header and the DB row both follow.
		await nameField.fill('New Name Nancy');
		await page.getByRole('button', { name: /save name/i }).click();
		await expect(page.getByText(/name updated/i)).toBeVisible();
		await expect(page.getByRole('navigation').getByText('New Name Nancy')).toBeVisible();
		const row = await getUserRow(email);
		expect(row?.display_name).toBe('New Name Nancy');
	});

	test('an empty name is refused and the row keeps its value', async ({ page }) => {
		const email = await makeApprovedUser('Keep Kept Kara');
		await signIn(page, email);

		await page.goto('/change-name');
		await expect(page.getByRole('heading', { name: /change name/i })).toBeVisible();
		const nameField = page.getByLabel('Your name');
		await expect(nameField).toHaveValue('Keep Kept Kara');

		await nameField.fill('   ');
		await page.getByRole('button', { name: /save name/i }).click();
		await expect(page.getByText(/please tell us your name/i)).toBeVisible();
		await expect(page.getByRole('navigation').getByText('Keep Kept Kara')).toBeVisible();
		expect((await getUserRow(email))?.display_name).toBe('Keep Kept Kara');
	});

	test('signing out from the menu returns to the public site', async ({ page }) => {
		const email = await makeApprovedUser('Bye Bye Bea');
		await signIn(page, email);

		await page.getByRole('navigation').getByRole('button', { name: 'Menu' }).click();
		await page.getByRole('menuitem', { name: 'Sign Out' }).click();

		await expect(page).toHaveURL('/');
		await expect(page.getByRole('navigation').getByRole('link', { name: 'Sign in' })).toBeVisible();
		await expect(page.getByRole('navigation').getByRole('button', { name: 'Menu' })).toHaveCount(0);
	});
});
