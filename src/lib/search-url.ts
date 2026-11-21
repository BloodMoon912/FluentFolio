// Search-result URL guard.
//
// The build-time index currently only contains fixed route prefixes, but the
// render/navigation sinks must not rely on that. A document's URL is accepted
// only when it resolves to the current origin AND to one of the four content
// route prefixes; everything else (javascript:, //evil.example, external
// origins, admin routes) returns null and is never put into href.

export const SEARCH_ROUTE_PREFIXES = ['/posts/blog/', '/posts/novel/', '/dictionary/', '/world/'] as const;

export function safeInternalSearchUrl(value: string, origin: string): string | null {
  if (!value) return null;

  try {
    const url = new URL(value, origin);
    if (url.origin !== origin) return null;
    if (!SEARCH_ROUTE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
