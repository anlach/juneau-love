/**
 * Client-side cache of presigned asset URLs from the `asset-url` function.
 * Presigned URLs are public by nature (see knowledge/api/asset-url.md), so
 * caching them in the page until near expiry is safe. Each entry holds the
 * full-size original URL and, when the row has one, the grid thumbnail's.
 */
export interface PresignedUrl {
	assetId: string;
	url: string;
	thumbUrl: string | null;
	expiresAt: number; // epoch ms
}

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

const cache = new Map<string, PresignedUrl>();

export function getCached(assetId: string): PresignedUrl | null {
	const entry = cache.get(assetId);
	if (!entry) return null;
	if (Date.now() > entry.expiresAt - REFRESH_MARGIN_MS) {
		cache.delete(assetId);
		return null;
	}
	return entry;
}

export function cacheUrl(
	assetId: string,
	url: string,
	thumbUrl: string | null,
	expiresAt: number
): void {
	cache.set(assetId, { assetId, url, thumbUrl, expiresAt });
}

export function clearCache(): void {
	cache.clear();
}
