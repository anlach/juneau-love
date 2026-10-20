import { supabase } from './supabase';
import { browser } from '$app/env';
import type { AuthChangeEvent, User } from '@supabase/supabase-js';

/**
 * Shared, client-side auth state, kept as a single reactive ($state) object.
 *
 * Svelte requires that exported module state be mutated by *property* (never
 * reassigned), so every update below assigns to `auth.<field>` rather than
 * replacing `auth` itself. Reading `auth.<field>` in any component is
 * automatically reactive.
 *
 * Server rendering never populates this (browser-only), so prerendered HTML
 * stays public.
 */

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface Profile {
	id: string;
	email: string;
	display_name: string | null;
	status: ApprovalStatus;
	email_confirmed_at: string | null;
	/** Set by notify-registration when the admins were alerted about this
	 *  pending registration (null until then — the layout's fallback uses it). */
	admin_notified_at: string | null;
}

export interface AuthSnapshot {
	/**
	 * loading  – auth still resolving (initial paint)
	 * anonymous – signed out
	 * ready    – signed in AND our `users` row loaded
	 * error    – signed in, but our `users` row couldn't be read
	 */
	kind: 'loading' | 'anonymous' | 'ready' | 'error';
	user: User | null;
	profile: Profile | null;
	message: string | null;
	/** RBAC permissions for the signed-in user (empty until `ready`). */
	perms: string[];
	/** Set when a used/failed magic link lands the browser (one-shot message). */
	linkError: string | null;
}

export const auth = $state<AuthSnapshot>({
	kind: 'loading',
	user: null,
	profile: null,
	message: null,
	perms: [],
	linkError: null
});

/**
 * RBAC helper. Reads `auth`'s reactive fields, so it is itself reactive when
 * called from a component render / `$derived` / `$effect`.
 */
export function hasPermission(permission: string): boolean {
	return auth.kind === 'ready' && auth.perms.includes(permission);
}

function clearSession(): void {
	auth.kind = 'anonymous';
	auth.user = null;
	auth.profile = null;
	auth.message = null;
	auth.perms = [];
}

/**
 * Load the signed-in user plus their `users` row and RBAC permissions.
 * See knowledge/api/current-user-state.md — the client never reads anyone
 * else's row (RLS forces `id = auth.uid()`).
 *
 * Callers must only invoke this when a session is present: `getUser()`
 * surfaces a missing session as an *error* (`AuthSessionMissingError`), not
 * as an empty result, so we treat that specific case as "signed out" rather
 * than a hard error.
 */
export async function refreshState(): Promise<void> {
	const { data, error } = await supabase.auth.getUser();
	if (error || !data.user) {
		// A missing/expired session is the anonymous case, not a failure.
		if (error && error.name !== 'AuthSessionMissingError') {
			auth.kind = 'error';
			auth.message = error.message;
			auth.user = null;
			auth.profile = null;
			auth.perms = [];
		} else {
			clearSession();
		}
		return;
	}

	const u = data.user;
	const [profileRes, permsRes] = await Promise.all([
		supabase
			.from('users')
			.select('id, email, display_name, status, email_confirmed_at, admin_notified_at')
			.eq('id', u.id)
			.maybeSingle(),
		supabase.from('user_permissions').select('permission').eq('user_id', u.id)
	]);

	if (profileRes.error) {
		auth.kind = 'error';
		auth.message = profileRes.error.message;
		auth.user = u;
		auth.profile = null;
		auth.perms = [];
		return;
	}

	const p = profileRes.data;
	auth.kind = 'ready';
	auth.message = null;
	auth.user = u;
	auth.profile = p
		? {
				id: p.id,
				email: p.email,
				display_name: p.display_name,
				status: p.status,
				email_confirmed_at: p.email_confirmed_at,
				admin_notified_at: p.admin_notified_at
			}
		: null;
	auth.perms = (permsRes.data ?? []).map((r: { permission: string }) => r.permission);
}

/**
 * Initialise auth once (called from the root layout on mount).
 *  - listens for sign-in/out/token events and refreshes our row
 *  - waits for the initial session (magic link / stored) to resolve
 *  - strips the token fragment from the URL
 */
export function initAuth(): void {
	if (!browser) return;

	supabase.auth.onAuthStateChange((event: AuthChangeEvent, session) => {
		// Refresh our row only when a session actually exists; every other
		// transition (sign-out, initial anonymous session) is the anonymous
		// case. Calling refreshState() with no session would make getUser()
		// report "Auth session missing" and flash an error state.
		if (session) void refreshState();
		else clearSession();
	});

	void supabase.auth.initialize().then(async ({ error }) => {
		// supabase-js already consumed a URL-fragment session and cleared the
		// hash on success. On a failed/used one-shot link, initialize() resolves
		// with the error (and leaves no fresh session), so surface it and drop
		// the now-meaningless fragment.
		if (/access_token=|error=/.test(location.hash)) {
			history.replaceState(null, '', location.pathname + location.search);
		}

		if (error) {
			auth.linkError =
				'That link has already been used or has expired. Request a fresh one.';
		}

		const { data } = await supabase.auth.getSession();
		if (data.session) {
			await refreshState();
		} else {
			clearSession();
		}
	});
}

export async function signOut(): Promise<void> {
	await supabase.auth.signOut();
	clearSession();
}
