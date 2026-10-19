import { execSync } from 'node:child_process';
import type { Page } from '@playwright/test';

/**
 * E2E helpers: talk to the local Supabase stack (GoTrue admin + PostgREST,
 * service role) so the browser tests can mint auth links out-of-band — the
 * stand-in for the mail provider — and assert on real DB state (RLS/trigger
 * behaviour the UI can't see).
 *
 * Requires the local stack: `supabase start`.
 */

export const BASE_URL = 'http://localhost:4173';
export const SUPABASE_URL = 'http://127.0.0.1:54321';
export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
export const REST_URL = `${SUPABASE_URL}/rest/v1`;

// Seeded local users (supabase/seed.sql) — used read-only where noted.
export const ADMIN_EMAIL = 'admin@local.dev';
export const GUEST_EMAIL = 'guest@local.dev';

let cachedKeys: { service: string; anon: string } | null = null;

function keys() {
	if (cachedKeys) return cachedKeys;
	// `npx supabase status` prints a JSON blob (plus a couple of WARN lines)
	// with the local keys derived from the stack's JWT secret.
	const out = execSync('npx supabase status', { encoding: 'utf8', cwd: process.cwd() });
	const line = out
		.split('\n')
		.map((l) => l.trim())
		.find((l) => l.startsWith('{'));
	if (!line) throw new Error('could not find supabase status JSON — is the stack running?');
	const d = JSON.parse(line) as { SERVICE_ROLE_KEY?: string; ANON_KEY?: string };
	if (!d.SERVICE_ROLE_KEY || !d.ANON_KEY)
		throw new Error('supabase status did not return the local keys');
	cachedKeys = { service: d.SERVICE_ROLE_KEY, anon: d.ANON_KEY };
	return cachedKeys;
}

function adminHeaders() {
	const { service } = keys();
	return { 'Content-Type': 'application/json', Authorization: `Bearer ${service}` };
}

/** Mint a one-shot auth link (GoTrue admin), the local stand-in for email. */
export async function generateLink(
	email: string,
	type: 'magiclink' | 'signup',
	redirectTo: string
): Promise<string> {
	const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
		method: 'POST',
		headers: adminHeaders(),
		body: JSON.stringify({ type, email, redirect_to: redirectTo })
	});
	if (!res.ok) throw new Error(`generate_link ${type} failed: ${res.status} ${await res.text()}`);
	const data = (await res.json()) as { action_link?: string };
	if (!data.action_link) throw new Error('generate_link returned no action_link');
	return data.action_link;
}

/** Create a fresh, unconfirmed auth user (→ a `users` row in 'pending'). */
export async function createUnconfirmedUser(displayName: string): Promise<string> {
	const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@local.dev`;
	const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
		method: 'POST',
		headers: adminHeaders(),
		body: JSON.stringify({
			email,
			email_confirm: false,
			user_metadata: { display_name: displayName }
		})
	});
	if (!res.ok) throw new Error(`create user failed: ${res.status} ${await res.text()}`);
	return email;
}

/** Confirm a user's email server-side by consuming a signup verify link. */
export async function confirmEmail(email: string): Promise<void> {
	const link = await generateLink(email, 'signup', `${BASE_URL}/auth/confirm`);
	await fetch(link, { redirect: 'follow' });
}

/** Consume a link's one-shot token (server-side) without storing a session. */
export async function consumeLink(link: string): Promise<void> {
	await fetch(link, { redirect: 'follow' });
}

export interface UserRow {
	id: string;
	email: string;
	display_name: string;
	status: 'pending' | 'approved' | 'rejected';
	email_confirmed_at: string | null;
}

function restHeaders() {
	const { service } = keys();
	return { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' };
}

/** Read the caller's `users` row with the service role (bypasses RLS). */
export async function getUserRow(email: string): Promise<UserRow | null> {
	const res = await fetch(`${REST_URL}/users?email=eq.${encodeURIComponent(email)}&select=*`, {
		headers: restHeaders()
	});
	if (!res.ok) throw new Error(`users read failed: ${res.status} ${await res.text()}`);
	const rows = (await res.json()) as UserRow[];
	return rows[0] ?? null;
}

export async function getRoleNames(userId: string): Promise<string[]> {
	const res = await fetch(
		`${REST_URL}/user_roles?select=roles(name)&user_id=eq.${userId}`,
		{ headers: restHeaders() }
	);
	if (!res.ok) throw new Error(`user_roles read failed: ${res.status} ${await res.text()}`);
	const rows = (await res.json()) as Array<{ roles: { name: string } | null }>;
	return rows.map((r) => r.roles?.name).filter((n): n is string => !!n);
}

/** Set/clear the login-link cooldown stamp (service role). */
export async function setLoginLinkCooldown(email: string, value: string | null): Promise<void> {
	const row = await getUserRow(email);
	if (!row) throw new Error(`no user row for ${email}`);
	const res = await fetch(`${REST_URL}/users?id=eq.${row.id}`, {
		method: 'PATCH',
		headers: restHeaders(),
		body: JSON.stringify({ last_login_link_sent_at: value })
	});
	if (!res.ok && res.status !== 204)
		throw new Error(`cooldown update failed: ${res.status} ${await res.text()}`);
}

/** Delete a test user (auth user; the `users` row cascades). */
export async function deleteAuthUser(email: string): Promise<void> {
	const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, {
		headers: adminHeaders()
	});
	if (!res.ok) return;
	const data = (await res.json()) as { users?: Array<{ id: string; email: string }> };
	const user = data.users?.find((u) => u.email === email);
	if (!user) return;
	await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
		method: 'DELETE',
		headers: adminHeaders()
	});
}

export async function invokeFunction(
	name: string,
	body: unknown,
	accessToken?: string
): Promise<{ status: number; data: any }> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
	const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
		method: 'POST',
		headers,
		body: JSON.stringify(body)
	});
	const text = await res.text();
	let data: any = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = text;
	}
	return { status: res.status, data };
}

/** Navigate the browser to a freshly minted auth link and let it land. */
export async function openAuthLink(
	page: Page,
	email: string,
	type: 'magiclink' | 'signup'
): Promise<void> {
	const redirectTo = type === 'signup' ? '/auth/confirm' : '/login';
	const link = await generateLink(email, type, `${BASE_URL}${redirectTo}`);
	await page.goto(link, { waitUntil: 'domcontentloaded' });
}

/** Poll `fn` until it returns a truthy value or the timeout elapses. */
export async function waitFor<T>(fn: () => Promise<T | null | false>, timeoutMs = 10_000): Promise<T> {
	const start = Date.now();
	for (;;) {
		const v = await fn();
		if (v) return v;
		if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
		await new Promise((r) => setTimeout(r, 300));
	}
}
