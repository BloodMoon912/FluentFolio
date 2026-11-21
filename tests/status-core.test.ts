import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decorateStatus,
  emptyStatusEdge,
  isStatusCheckDue,
  normaliseStatusHistory,
  readStatusSystem,
  statusCheckCutoff,
  statusHistoryStart,
  statusOverallOk,
  summariseStatusDetail,
  STATUS_CHECK_INTERVAL_SECONDS,
  STATUS_HISTORY_HOURS,
  STATUS_HISTORY_LIMIT,
  STATUS_RUNTIME_NAME,
  type CachedStatusPayload,
} from '../src/lib/status-core.ts';

const NOW = 1_800_000_000; // arbitrary fixed Unix time

const row = (checkedAt: number, ok = 1, detail: string | null = null) => ({ checked_at: checkedAt, ok, detail });

describe('readStatusSystem (per-request edge metadata)', () => {
  const NOW_ISO = '2026-11-03T00:00:00.000Z';

  it('maps every request.cf field and the runtime name', () => {
    const system = readStatusSystem(
      {
        colo: 'HKG',
        country: 'HK',
        city: 'Hong Kong',
        region: 'Central and Western',
        asOrganization: 'Example ISP',
        httpProtocol: 'HTTP/2',
        tlsVersion: 'TLSv1.3',
      },
      NOW_ISO,
    );

    assert.equal(system.runtime, STATUS_RUNTIME_NAME);
    assert.equal(system.now, NOW_ISO);
    assert.deepEqual(system.edge, {
      colo: 'HKG',
      country: 'HK',
      city: 'Hong Kong',
      region: 'Central and Western',
      asOrganization: 'Example ISP',
      httpProtocol: 'HTTP/2',
      tlsVersion: 'TLSv1.3',
    });
  });

  it('falls back to nulls when cf metadata is missing or malformed', () => {
    assert.deepEqual(readStatusSystem(undefined, NOW_ISO).edge, emptyStatusEdge());
    assert.deepEqual(readStatusSystem({}, NOW_ISO).edge, emptyStatusEdge());
    assert.deepEqual(readStatusSystem({ city: 42, colo: null }, NOW_ISO).edge, emptyStatusEdge());
  });
});

describe('decorateStatus', () => {
  const CACHED_PAYLOAD: CachedStatusPayload = {
    ok: true,
    services: [
      { key: 'website', ok: true, latencyMs: 4, detailCode: 'worker_ok' },
      { key: 'database', ok: true, latencyMs: 2, detailCode: 'db_ok' },
    ],
    history: [{ checkedAt: 1_799_999_700, ok: true, detail: 'ok' }],
  };

  const CF_A = {
    colo: 'HKG',
    country: 'HK',
    city: 'Hong Kong',
    region: 'Central and Western',
    asOrganization: 'ISP A',
  };
  const CF_B = { colo: 'HKG', country: 'HK', city: 'Kowloon', region: 'Kwun Tong', asOrganization: 'ISP B' };

  it('attaches each request’s own system block and timestamp without mutating the cached payload', () => {
    const snapshot = structuredClone(CACHED_PAYLOAD);

    const a = decorateStatus(CACHED_PAYLOAD, CF_A, '2026-11-03T00:00:00.000Z');
    const b = decorateStatus(CACHED_PAYLOAD, CF_B, '2026-11-03T00:00:05.000Z');

    assert.equal(a.system.edge.city, 'Hong Kong');
    assert.equal(a.system.edge.region, 'Central and Western');
    assert.equal(a.system.edge.asOrganization, 'ISP A');
    assert.equal(b.system.edge.city, 'Kowloon');
    assert.equal(b.system.edge.region, 'Kwun Tong');
    assert.equal(b.system.edge.asOrganization, 'ISP B');
    assert.equal(a.checkedAt, '2026-11-03T00:00:00.000Z');
    assert.equal(b.checkedAt, '2026-11-03T00:00:05.000Z');

    // The shared value is copied, never mutated: a cache hit can be decorated
    // many times with different visitors' data.
    assert.deepEqual(CACHED_PAYLOAD, snapshot);
    assert.equal('system' in (CACHED_PAYLOAD as unknown as Record<string, unknown>), false);
    assert.equal('checkedAt' in (CACHED_PAYLOAD as unknown as Record<string, unknown>), false);
    assert.notEqual(a.system, b.system);
  });
});

describe('status probe throttling', () => {
  it('uses a five-minute interval and 24-hour window', () => {
    assert.equal(STATUS_CHECK_INTERVAL_SECONDS, 300);
    assert.equal(STATUS_HISTORY_HOURS, 24);
    assert.equal(STATUS_HISTORY_LIMIT, 288);
    assert.equal(statusCheckCutoff(NOW), NOW - 300);
    assert.equal(statusHistoryStart(NOW), NOW - 86_400);
  });

  it('records the first sample when there is no history', () => {
    assert.equal(isStatusCheckDue(NOW, null), true);
    assert.equal(isStatusCheckDue(NOW, undefined), true);
  });

  it('is due exactly at the interval boundary and after it', () => {
    assert.equal(isStatusCheckDue(NOW, NOW - 299), false);
    assert.equal(isStatusCheckDue(NOW, NOW - 300), true);
    assert.equal(isStatusCheckDue(NOW, NOW - 301), true);
  });

  it('treats invalid stored timestamps as "no history" instead of blocking writes', () => {
    assert.equal(isStatusCheckDue(NOW, Number.NaN), true);
    assert.equal(isStatusCheckDue(NOW, Number.POSITIVE_INFINITY), true);
  });
});

describe('statusOverallOk', () => {
  it('requires every probe to be healthy', () => {
    assert.equal(
      statusOverallOk([
        { key: 'website', ok: true },
        { key: 'database', ok: true },
      ]),
      true,
    );
    assert.equal(
      statusOverallOk([
        { key: 'website', ok: true },
        { key: 'activity', ok: false },
      ]),
      false,
    );
  });

  it('does not call an empty service list healthy', () => {
    assert.equal(statusOverallOk([]), false);
  });
});

describe('summariseStatusDetail', () => {
  it('stores failing service keys, or "ok"', () => {
    assert.equal(
      summariseStatusDetail([
        { key: 'website', ok: true },
        { key: 'database', ok: true },
      ]),
      'ok',
    );
    assert.equal(
      summariseStatusDetail([
        { key: 'website', ok: true },
        { key: 'database', ok: false },
        { key: 'steam', ok: false },
      ]),
      'database,steam',
    );
  });
});

describe('normaliseStatusHistory', () => {
  it('returns an empty list for no rows', () => {
    assert.deepEqual(normaliseStatusHistory([], NOW), []);
  });

  it('drops rows older than 24 hours and rows from the future', () => {
    const history = normaliseStatusHistory(
      [row(NOW - 90_000), row(NOW - 86_401, 0, 'activity'), row(NOW - 60, 1, 'ok'), row(NOW + 60)],
      NOW,
    );
    assert.deepEqual(
      history.map((entry) => entry.checkedAt),
      [NOW - 60],
    );
  });

  it('sorts oldest-first, maps the integer flag and trims detail', () => {
    const history = normaliseStatusHistory([row(NOW - 10, 0, ' steam '), row(NOW - 20, 1, '  ')], NOW);
    assert.deepEqual(history, [
      { checkedAt: NOW - 20, ok: true, detail: 'ok' },
      { checkedAt: NOW - 10, ok: false, detail: 'steam' },
    ]);
  });

  it('caps the returned window at the row budget', () => {
    const rows = Array.from({ length: 10 }, (_, index) => row(NOW - index * 60));
    const history = normaliseStatusHistory(rows, NOW, 3);
    assert.equal(history.length, 3);
    assert.deepEqual(
      history.map((entry) => entry.checkedAt),
      [NOW - 120, NOW - 60, NOW],
    );
  });
});
