import { browser } from '$app/env';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$app/env/public';

// Stock supabase-js setup (see knowledge/api/client-auth.md):
//  - anon key only — Postgres RLS is the security boundary, never this client
//  - localStorage + persistSession: the magic-link session (delivered in the
//    URL fragment) survives reloads
//  - detectSessionInUrl: supabase-js picks the session out of the fragment
//    and clears the URL (verified against the installed auth-js source)
export const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
	auth: {
		storage: browser ? localStorage : undefined,
		persistSession: true,
		autoRefreshToken: true,
		detectSessionInUrl: true
	}
});
