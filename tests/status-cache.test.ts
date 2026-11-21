import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cachedJson, type CachedJsonStore } from '../src/lib/cached-json.ts';
import { decorateStatus, type CachedStatusPayload, type StatusPayload } from '../src/lib/status-core.ts';

/**
 * Regression test for the /api/status cache privacy bug:
 *
 * Two visitors are served by the same Cloudflare colo, so `request.cf` reports a
 * different city/region/ISP for each. The shared cache entry may only contain the
 * probe payload (ok/services/history) — the system block is rebuilt from the
 * *current* request by `decorateStatus` (the same function the route uses), after
 * the cache read. If the system block were part of the cached value, visitor B
 * would see visitor A's location for the whole TTL (30 s).
 */

const ENDPOINT = 'https://www.example.com/api/status';

const VISITOR_A_CF = {
  colo: 'HKG',
  country: 'HK',
  city: 'Hong Kong',
  region: 'Central and Western',
  asOrganization: 'ISP A',
  httpProtocol: 'HTTP/2',
  tlsVersion: 'TLSv1.3',
};

const VISITOR_B_CF = {
  colo: 'HKG',
  country: 'HK',
  city: 'Kowloon',
  region: 'Kwun Tong',
  asOrganization: 'ISP B',
  httpProtocol: 'HTTP/2',
  tlsVersion: 'TLSv1.3',
};

function memoryCache() {
  const stored = new Map<string, Response>();
  const cache: CachedJsonStore = {
    async match(request) {
      return stored.get(request.url)?.clone();
    },
    async put(request, response) {
      stored.set(request.url, response.clone());
    },
  };
  return { cache, stored };
}

const CACHED_PAYLOAD: CachedStatusPayload = {
  ok: true,
  services: [{ key: 'website', ok: true, latencyMs: 1, detailCode: 'worker_ok' }],
  history: [],
};

describe('/api/status cache and per-request system metadata', () => {
  it('shares the probe payload but rebuilds the requester location for every visitor', async () => {
    const { cache, stored } = memoryCache();
    let producerCalls = 0;

    const respond = async (cf: unknown, now: string) =>
      (
        await cachedJson<CachedStatusPayload, StatusPayload>(
          new Request(ENDPOINT),
          30,
          async () => {
            producerCalls += 1;
            return CACHED_PAYLOAD;
          },
          {
            cache,
            // Exactly what the route does: the closure captures the current
            // request's cf, and the shared decorateStatus helper attaches it
            // after the cache read.
            decorate: (payload) => decorateStatus(payload, cf, now),
          },
        )
      ).json();

    const visitorA = (await respond(VISITOR_A_CF, '2026-11-03T00:00:00.000Z')) as StatusPayload;
    const visitorB = (await respond(VISITOR_B_CF, '2026-11-03T00:00:05.000Z')) as StatusPayload;

    assert.equal(producerCalls, 1, 'the probe payload is reused from the cache');
    assert.equal(visitorA.system.edge.city, 'Hong Kong');
    assert.equal(visitorB.system.edge.city, 'Kowloon');
    assert.equal(visitorB.system.edge.region, 'Kwun Tong');
    assert.equal(visitorA.checkedAt, '2026-11-03T00:00:00.000Z');
    assert.equal(visitorB.checkedAt, '2026-11-03T00:00:05.000Z');

    // The shared cache entry must not contain any per-request metadata.
    const cached = (await stored.get(ENDPOINT)?.json()) as Record<string, unknown>;
    assert.deepEqual(cached, CACHED_PAYLOAD);
    assert.equal('system' in cached, false);
    assert.equal('checkedAt' in cached, false);
  });
});
