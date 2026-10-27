import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
	// Both keys are derived from the local stack's default JWT secret
	// (config.toml, never customised): the anon key is committed in
	// .env.test (the value the e2e build is baked with), and the
	// service-role key is minted from the same secret. We deliberately do
	// not parse `supabase status` — its JSON blob is absent from stdout on
	// GitHub runners, which broke the whole suite there.
	const anonLine = readFileSync('.env.test', 'utf8')
		.split('\n')
		.find((l) => l.startsWith('PUBLIC_SUPABASE_ANON_KEY='));
	if (!anonLine) throw new Error('.env.test has no PUBLIC_SUPABASE_ANON_KEY');
	const service = execSync('npx supabase gen bearer-jwt --role service_role', {
		encoding: 'utf8',
		cwd: process.cwd()
	})
		.trim()
		.split('\n')
		.pop()!;
	if (!service.startsWith('eyJ'))
		throw new Error('could not mint the local service-role key');
	cachedKeys = {
		service,
		anon: anonLine.slice('PUBLIC_SUPABASE_ANON_KEY='.length).trim()
	};
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
	/** Set by notify-registration when the admins were alerted (null until then). */
	admin_notified_at: string | null;
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

/** Set the user's approval status directly (service role, allowed
 * transition only) — simulates prior admin action for negative tests. */
export async function setUserStatus(email: string, status: 'approved' | 'rejected'): Promise<void> {
	const row = await getUserRow(email);
	if (!row) throw new Error(`no user row for ${email}`);
	const res = await fetch(`${REST_URL}/users?id=eq.${row.id}`,
		{ method: 'PATCH', headers: restHeaders(), body: JSON.stringify({ status }) });
	if (!res.ok && res.status !== 204)
		throw new Error(`status update failed: ${res.status} ${await res.text()}`);
}

/** Read a user's asset rows (service role, bypasses RLS). */
export interface AssetRow {
	id: string;
	user_id: string;
	s3_key: string;
	thumb_s3_key: string | null;
	content_type: string;
	byte_size: number;
	caption: string | null;
	created_at: string;
}

export async function getAssetsForUser(userId: string): Promise<AssetRow[]> {
	const res = await fetch(`${REST_URL}/assets?user_id=eq.${userId}&select=*`, {
		headers: restHeaders()
	});
	if (!res.ok) throw new Error(`assets read failed: ${res.status} ${await res.text()}`);
	return (await res.json()) as AssetRow[];
}

/**
 * GET a private-bucket object through the storage API (local stack,
 * service role) — the same path a presigned GET resolves to, without
 * needing the signed URL.
 */
export async function getStorageObject(key: string): Promise<Response> {
	return fetch(`${SUPABASE_URL}/storage/v1/object/juneau-assets/${key}`, {
		headers: { Authorization: `Bearer ${keys().service}` }
	});
}

/**
 * Delete a user's asset rows **and** the S3 objects behind them (local
 * stack, service role). Keeps the gallery empty between runs so tests
 * that assert the empty state stay valid. The S3 objects are removed via
 * the storage API — the S3 protocol has no bucket listing to find keys.
 */
export async function deleteAssetsForUser(userId: string): Promise<void> {
	const res = await fetch(`${REST_URL}/assets?user_id=eq.${userId}&select=s3_key,thumb_s3_key`, {
		headers: restHeaders()
	});
	if (!res.ok) throw new Error(`assets read failed: ${res.status} ${await res.text()}`);
	const rows = (await res.json()) as Array<{ s3_key: string; thumb_s3_key: string | null }>;
	for (const { s3_key, thumb_s3_key } of rows) {
		for (const key of [s3_key, thumb_s3_key]) {
			if (!key) continue;
			// No Content-Type header: storage-api rejects a DELETE that claims
			// application/json with an empty body.
			const del = await fetch(
				`${SUPABASE_URL}/storage/v1/object/juneau-assets/${key}`,
				{ method: 'DELETE', headers: { Authorization: `Bearer ${keys().service}` } }
			);
			if (!del.ok && del.status !== 204)
				throw new Error(`S3 object delete failed: ${del.status} ${key}`);
		}
	}
	if (rows.length) {
		const del = await fetch(`${REST_URL}/assets?user_id=eq.${userId}`, {
			method: 'DELETE',
			headers: restHeaders()
		});
		if (!del.ok && del.status !== 204) throw new Error(`assets delete failed: ${del.status}`);
	}
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
