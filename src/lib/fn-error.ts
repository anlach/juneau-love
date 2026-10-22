/**
 * Decoding failed edge-function calls.
 *
 * supabase-js wraps a non-2xx response in a `FunctionsHttpError` whose
 * `context` is the *raw Response* — not the parsed body. The structured
 * error codes our functions return (`{ "error": "<code>" }`) must be read
 * off the `response` that `invoke` returns alongside the error.
 */
export async function functionErrorCode(
	response: Response | undefined
): Promise<string | null> {
	if (!response) return null;
	try {
		const body = (await response.json()) as { error?: string };
		return body?.error ?? null;
	} catch {
		// Non-JSON error body (e.g. the edge runtime's "Function not found"
		// text) — no code to decode.
		return null;
	}
}
