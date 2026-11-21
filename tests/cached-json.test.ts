import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cachedJson,
  cachedJsonCacheControl,
  cachedJsonPrivateCacheControl,
  cachedJsonStoredCacheControl,
  type CachedJsonStore,
} from '../src/lib/cached-json.ts';

/** In-memory `Cache`-like store that records every key it is asked about. */
function memoryCache() {
  const stored = new Map<string, Response>();
  const matches: Request[] = [];
  const puts: Request[] = [];
  const cache: CachedJsonStore = {
    async match(request) {
      matches.push(request);
      const hit = stored.get(request.url);
      return hit ? hit.clone() : undefined;
    },
    async put(request, response) {
      puts.push(request);
      stored.set(request.url, response.clone());
    },
  };
  return { cache, matches, puts, stored };
}

function apiRequest(path = '/api/visitors', headers: Record<string, string> = {}) {
  return new Request(`https://www.example.com${path}`, { headers });
}

function producer<T>(value: T) {
  const calls: Array<{ count: number }> = [];
  const fn = async () => {
    calls.push({ count: calls.length + 1 });
    return value;
  };
  return { fn, calls };
}

describe('cachedJsonCacheControl', () => {
  it('lets the browser revalidate but lets the edge cache for the ttl', () => {
    assert.equal(cachedJsonCacheControl(10), 'public, max-age=0, s-maxage=10');
    assert.equal(cachedJsonCacheControl(60), 'public, max-age=0, s-maxage=60');
  });

  it('stores the cached copy with a non-zero max-age so it can actually be reused', () => {
    // `Cache.put` derives its lifetime from Cache-Control; a stored
    // `max-age=0` can be treated as immediately stale, turning the cache into a
    // silent no-op. The browser never sees this stored header.
    assert.equal(cachedJsonStoredCacheControl(10), 'public, max-age=10');
    assert.equal(cachedJsonStoredCacheControl(60), 'public, max-age=60');
    assert.notEqual(cachedJsonStoredCacheControl(10), cachedJsonCacheControl(10));
  });

  it('marks responses with per-visitor fields private', () => {
    assert.equal(cachedJsonPrivateCacheControl(), 'private, max-age=0');
    assert.notEqual(cachedJsonPrivateCacheControl(), cachedJsonCacheControl(10));
  });
});

describe('cachedJson', () => {
  it('runs the producer on a miss, stores the value and returns its JSON', async () => {
    const { cache, puts, stored } = memoryCache();
    const { fn, calls } = producer({ total: 5 });

    const response = await cachedJson(apiRequest(), 10, fn, { cache });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=0, s-maxage=10');
    assert.equal(response.headers.get('x-cache'), 'MISS');
    assert.deepEqual(await response.json(), { total: 5 });
    assert.equal(calls.length, 1);
    assert.equal(puts.length, 1);

    const storedResponse = stored.get('https://www.example.com/api/visitors');
    assert.ok(storedResponse, 'the response was stored under the cache key');
    assert.equal(
      storedResponse.headers.get('cache-control'),
      'public, max-age=10',
      'the stored copy needs a real TTL, not max-age=0',
    );
    assert.deepEqual(await storedResponse.json(), { total: 5 });
  });

  it('serves a hit without calling the producer again and reports x-cache: HIT', async () => {
    const { cache } = memoryCache();
    const { fn, calls } = producer({ total: 5 });

    const first = await cachedJson(apiRequest(), 10, fn, { cache });
    const second = await cachedJson(apiRequest(), 10, fn, { cache });

    assert.equal(first.headers.get('x-cache'), 'MISS');
    assert.equal(second.headers.get('x-cache'), 'HIT');
    assert.equal(calls.length, 1);
    assert.deepEqual(await second.json(), { total: 5 });
  });

  it('keys the cache by origin + pathname only: no cookie, no query string', async () => {
    const { cache, matches, puts } = memoryCache();
    const { fn } = producer({ total: 5 });

    await cachedJson(apiRequest('/api/visitors?utm_source=feed', { cookie: '__Host-bm-visit=secret' }), 10, fn, {
      cache,
    });

    const key = 'https://www.example.com/api/visitors';
    assert.equal(matches[0].url, key);
    assert.equal(puts[0].url, key);
    assert.equal(matches[0].method, 'GET');
    assert.equal(matches[0].headers.get('cookie'), null, 'the cache key must never carry the Cookie header');
  });

  it('merges decorate() on every request but never stores its fields', async () => {
    const { cache, stored } = memoryCache();
    const { fn, calls } = producer({ total: 5 });
    const decorate = (value: { total: number }) => ({ ...value, visited: true });

    const first = await cachedJson(apiRequest(), 60, fn, { cache, decorate });
    const second = await cachedJson(apiRequest(), 60, fn, { cache, decorate });

    assert.deepEqual(await first.json(), { total: 5, visited: true });
    assert.deepEqual(await second.json(), { total: 5, visited: true });
    assert.equal(calls.length, 1, 'the shared cached value is reused');
    // A decorated payload contains per-visitor fields, so a shared cache must not
    // reuse the response — but the Worker's own undecorated copy still has a TTL.
    assert.equal(first.headers.get('cache-control'), 'private, max-age=0');
    assert.equal(second.headers.get('cache-control'), 'private, max-age=0');
    const storedResponse = stored.get('https://www.example.com/api/visitors');
    assert.equal(storedResponse?.headers.get('cache-control'), 'public, max-age=60');
    assert.deepEqual(await storedResponse?.json(), { total: 5 });
  });

  it('bypasses the cache entirely with cache: null', async () => {
    const { fn, calls } = producer({ total: 5 });
    await cachedJson(apiRequest(), 10, fn, { cache: null });
    await cachedJson(apiRequest(), 10, fn, { cache: null });
    assert.equal(calls.length, 2);
  });

  it('degrades to the producer when the cache read throws', async () => {
    const cache: CachedJsonStore = {
      async match() {
        throw new Error('cache read down');
      },
      async put() {
        throw new Error('cache write down');
      },
    };
    const { fn, calls } = producer({ ok: true });
    const response = await cachedJson(apiRequest(), 10, fn, { cache });
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(calls.length, 1);
  });

  it('still responds when only the cache write throws', async () => {
    const cache: CachedJsonStore = {
      async match() {
        return undefined;
      },
      async put() {
        throw new Error('cache write down');
      },
    };
    const response = await cachedJson(apiRequest(), 10, producer({ ok: true }).fn, { cache });
    assert.deepEqual(await response.json(), { ok: true });
  });

  it('does not cache a rejected producer', async () => {
    const { cache, puts } = memoryCache();
    await assert.rejects(
      cachedJson(
        apiRequest(),
        10,
        async () => {
          throw new Error('upstream down');
        },
        { cache },
      ),
      /upstream down/,
    );
    assert.equal(puts.length, 0);
  });

  it('hands the cache write to waitUntil instead of blocking on it', async () => {
    const { cache, stored } = memoryCache();
    const waits: Promise<unknown>[] = [];
    const response = await cachedJson(apiRequest(), 10, producer({ ok: true }).fn, {
      cache,
      waitUntil: (promise) => waits.push(promise),
    });
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(waits.length, 1);
    await waits[0];
    assert.ok(stored.get('https://www.example.com/api/visitors'), 'the background write completed');
  });

  it('works without an injected cache when caches.default is unavailable (plain Node)', async () => {
    // Node has no `caches` global; the helper must silently run the producer
    // rather than throw. (In Workers it resolves to caches.default.)
    assert.equal(typeof globalThis.caches, 'undefined');
    const { fn, calls } = producer({ ok: true });
    const response = await cachedJson(apiRequest(), 10, fn);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(calls.length, 1);
  });
});
