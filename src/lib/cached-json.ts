/**
 * Shared Cache API helper for the site's public JSON endpoints.
 *
 * `caches.default` is a per-colo HTTP cache keyed by URL. Every poll of the
 * homepage dashboard (and /status) used to hit Lanyard / Steam / D1 again, even
 * for rows that barely change, so the responses are cached here for a few
 * seconds (#7).
 *
 * Rules this module enforces, because getting them wrong is a privacy bug:
 *
 * - **The cache key is origin + pathname only.** Query strings and request
 *   headers — including `Cookie` — are dropped, so a cookie-bearing request can
 *   never store or read a personalised response.
 * - **Nothing per-request goes into the cache.** The `producer` must be
 *   request-independent. Per-request fields (for example `/api/visitors`'s
 *   cookie-derived `visited`, or `/api/status`'s requester city/region) are
 *   merged with `decorate` *after* the cache read, so they are added on every
 *   request and never stored.
 * - **The stored copy carries a real TTL, the browser copy does not.**
 *   `Cache.put` derives its lifetime from the response's `Cache-Control`, and
 *   `max-age=0` can make the entry immediately stale (a cache that never hits
 *   is a silent #7 regression). The stored response therefore uses
 *   `public, max-age=<ttl>`, while the response returned to the browser keeps
 *   `public, max-age=0, s-maxage=<ttl>` for shared payloads.
 * - **A decorated response is private.** Once `decorate` adds per-visitor fields
 *   (a cookie-derived `visited`, the requester's city/region/ISP), the returned
 *   response must not be reusable by a shared cache other than this Worker, so
 *   it is labelled `private, max-age=0`. Only the undecorated `/api/activity`
 *   response stays `public, max-age=0, s-maxage=<ttl>`.
 * - **A cache failure never fails the request.** `match`/`put` errors degrade to
 *   running the producer.
 *
 * `CloudflareCache`/`caches` are ambient-declared in `src/cloudflare-runtime.d.ts`
 * because the project does not load the WebWorker TypeScript lib.
 */

/** The subset of the Workers Cache API (`caches.default`) this helper needs. */
export interface CachedJsonStore {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface CachedJsonOptions<T, R = T> {
  /** Cache to use. Omit to use `caches.default`; pass `null` to bypass caching. */
  cache?: CachedJsonStore | null;
  /**
   * Run the cache write in the background instead of awaiting it, e.g.
   * `(promise) => locals.cfContext?.waitUntil(promise)`.
   */
  waitUntil?: (promise: Promise<unknown>) => void;
  /**
   * Applied to every request *after* the (possibly cached) value is read. Use
   * this for cookie-derived, geo-derived or otherwise per-request fields; they
   * are merged on every request and never written to the shared cache.
   */
  decorate?: (value: T) => R;
}

/** `cache-control` for the response returned to the browser (edge cache only). */
export function cachedJsonCacheControl(ttlSeconds: number): string {
  return `public, max-age=0, s-maxage=${ttlSeconds}`;
}

/**
 * `cache-control` for a response that `decorate` has made per-visitor. Other
 * shared caches (and the browser) must not store it; only the Worker's own copy
 * of the undecorated payload is shared.
 */
export function cachedJsonPrivateCacheControl(): string {
  return 'private, max-age=0';
}

/**
 * `cache-control` for the copy stored in the Workers cache. `Cache.put` needs a
 * non-zero `max-age` to keep the entry alive for `ttlSeconds`; the browser never
 * sees this value.
 */
export function cachedJsonStoredCacheControl(ttlSeconds: number): string {
  return `public, max-age=${ttlSeconds}`;
}

function resolveCache(store: CachedJsonStore | null | undefined): CachedJsonStore | null {
  if (store !== undefined) return store;
  try {
    // `caches` only exists in the Workers runtime; plain Node tests do not have
    // it, so the helper degrades to "no cache" there instead of throwing.
    return typeof caches === 'undefined' || !caches.default ? null : caches.default;
  } catch {
    return null;
  }
}

function cacheKeyFor(request: Request): Request {
  const url = new URL(request.url);
  return new Request(`${url.origin}${url.pathname}`, { method: 'GET' });
}

/**
 * Serve `producer()`'s JSON value through the Cache API for `ttlSeconds`.
 *
 * @returns a `Response` with the JSON body, a `x-cache: HIT|MISS` diagnostic
 *          header, and `cache-control: public, max-age=0, s-maxage=<ttl>` — or
 *          `private, max-age=0` when `decorate` adds per-visitor fields.
 *
 * `producer` must return a JSON-serialisable value and must not return
 * `undefined` (that represents a cache miss here). It must not depend on
 * request headers, cookies, query strings or Cloudflare geo metadata.
 */
export async function cachedJson<T, R = T>(
  request: Request,
  ttlSeconds: number,
  producer: () => Promise<T>,
  options: CachedJsonOptions<T, R> = {},
): Promise<Response> {
  const cache = resolveCache(options.cache);
  const key = cacheKeyFor(request);
  const storedCacheControl = cachedJsonStoredCacheControl(ttlSeconds);
  // Decorated payloads contain per-visitor data (cookie-derived or request.cf),
  // so only the undecorated response may be marked public/shareable.
  const responseCacheControl = options.decorate ? cachedJsonPrivateCacheControl() : cachedJsonCacheControl(ttlSeconds);

  let value: T | undefined;
  let servedFromCache = false;
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) {
        value = (await hit.json()) as T;
        servedFromCache = true;
      }
    } catch {
      console.warn('[cached-json] cache read failed; falling back to the producer');
    }
  }

  if (value === undefined) {
    value = await producer();

    if (cache) {
      // The stored copy contains the producer value only, never `decorate`'s
      // per-request fields.
      const stored = new Response(JSON.stringify(value), {
        headers: { 'content-type': 'application/json', 'cache-control': storedCacheControl },
      });
      const write = cache.put(key, stored).catch((error: unknown) => {
        console.warn(`[cached-json] cache write failed: ${error instanceof Error ? error.message : String(error)}`);
      });
      if (options.waitUntil) options.waitUntil(write);
      else await write;
    }
  }

  const payload = (options.decorate ? options.decorate(value) : value) as R;
  return Response.json(payload, {
    headers: { 'cache-control': responseCacheControl, 'x-cache': servedFromCache ? 'HIT' : 'MISS' },
  });
}
