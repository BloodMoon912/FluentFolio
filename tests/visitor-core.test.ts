import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  VISIT_ANALYTICS_DAYS,
  VISIT_CLEANUP_CHANCE,
  VISIT_DUPLICATE_WINDOW_SECONDS,
  VISIT_OVERVIEW_DAYS,
  VISIT_PATH_MAX_LENGTH,
  VISIT_RETENTION_DAYS,
  duplicateVisitQuery,
  duplicateWindowModifier,
  isDuplicateVisit,
  parseReferrerHost,
  sanitizeVisitPath,
  shouldAttemptVisitCleanup,
  utcDay,
  fillDailyGaps,
  visitRetentionModifier,
  visitRetentionQuery,
  type VisitorDatabase,
} from '../src/lib/visitor-core.ts';

/** Fake D1 that records every prepared statement and returns queued rows. */
function fakeDatabase(rows: Array<Record<string, unknown> | null>) {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const db: VisitorDatabase = {
    prepare(query) {
      return {
        bind(...values) {
          calls.push({ query, values });
          return {
            async first<T = Record<string, unknown>>(): Promise<T | null> {
              const row = rows.shift();
              return (row ?? null) as T | null;
            },
          };
        },
      };
    },
  };
  return { db, calls };
}

describe('visitor-core constants', () => {
  it('uses the audit windows', () => {
    assert.equal(VISIT_ANALYTICS_DAYS, 30);
    assert.equal(VISIT_OVERVIEW_DAYS, 180);
    assert.equal(VISIT_RETENTION_DAYS, 180);
    assert.equal(VISIT_DUPLICATE_WINDOW_SECONDS, 30);
    assert.equal(VISIT_PATH_MAX_LENGTH, 200);
    assert.ok(VISIT_CLEANUP_CHANCE > 0 && VISIT_CLEANUP_CHANCE <= 0.01);
  });
});

describe('sanitizeVisitPath', () => {
  it('accepts the visitor-facing routes', () => {
    for (const path of [
      '/',
      '/posts',
      '/posts/blog/some-slug',
      '/posts/novel/chapter-1',
      '/dictionary/entry',
      '/world/place',
      '/status',
      '/about',
      '/privacy',
      '/terms',
    ]) {
      assert.equal(sanitizeVisitPath(path), path, path);
    }
  });

  it('strips the query string and fragment', () => {
    assert.equal(sanitizeVisitPath('/posts?tab=novel'), '/posts');
    assert.equal(sanitizeVisitPath('/posts/blog/some-slug?utm=x#top'), '/posts/blog/some-slug');
    assert.equal(sanitizeVisitPath('/status#history'), '/status');
  });

  it('accepts percent-encoded slugs', () => {
    assert.equal(sanitizeVisitPath('/posts/blog/caf%C3%A9'), '/posts/blog/caf%C3%A9');
  });

  it('rejects non-string, empty and relative values', () => {
    for (const value of [undefined, null, 42, {}, [], '', '   ', 'posts', '//evil.com']) {
      assert.equal(sanitizeVisitPath(value), null, String(value));
    }
  });

  it('rejects routes the beacon must never record', () => {
    for (const path of ['/admin', '/admin/login', '/api/visitors', '/og', '/og.svg', '/blog']) {
      assert.equal(sanitizeVisitPath(path), null, path);
    }
  });

  it('rejects unknown, similar-but-wrong and traversal paths', () => {
    for (const path of [
      '/abcdef',
      '/posts-archive',
      '/postsx',
      '/statuses',
      '/posts/../admin',
      '/posts/./about',
      '/posts /x',
      '/posts\u0000',
    ]) {
      assert.equal(sanitizeVisitPath(path), null, path);
    }
  });

  it('enforces the 200-character bound after stripping', () => {
    const exactly200 = `/posts/${'a'.repeat(VISIT_PATH_MAX_LENGTH - '/posts/'.length)}`;
    assert.equal(exactly200.length, VISIT_PATH_MAX_LENGTH);
    assert.equal(sanitizeVisitPath(exactly200), exactly200);

    const tooLong = `${exactly200}a`;
    assert.equal(tooLong.length, VISIT_PATH_MAX_LENGTH + 1);
    assert.equal(sanitizeVisitPath(tooLong), null);

    // The bound applies to the path, not to a long query string that is dropped.
    assert.equal(sanitizeVisitPath(`/about?${'x'.repeat(500)}`), '/about');
  });
});

describe('parseReferrerHost', () => {
  const OWN = ['www.mysite.test', 'mysite.test'];

  it('keeps an external hostname', () => {
    assert.equal(parseReferrerHost('https://news.ycombinator.com/item?id=1', OWN), 'news.ycombinator.com');
    assert.equal(parseReferrerHost('http://example.org/path', OWN), 'example.org');
  });

  it('drops the port and normalises case and a trailing dot', () => {
    assert.equal(parseReferrerHost('https://Example.COM.:443/x', OWN), 'example.com');
  });

  it('excludes the site own www and apex hostnames', () => {
    assert.equal(parseReferrerHost('https://www.mysite.test/posts', OWN), null);
    assert.equal(parseReferrerHost('https://mysite.test/posts', OWN), null);
    // Also when the request itself arrived on the apex host.
    assert.equal(parseReferrerHost('https://www.mysite.test/', ['mysite.test']), null);
  });

  it('keeps other subdomains of the site domain', () => {
    assert.equal(parseReferrerHost('https://img.mysite.test/x', OWN), 'img.mysite.test');
  });

  it('rejects empty, non-HTTP(S) and malformed values', () => {
    for (const value of [undefined, null, 42, '', '   ', 'not a url', 'javascript:alert(1)', 'mailto:a@b.com']) {
      assert.equal(parseReferrerHost(value, OWN), null, String(value));
    }
  });

  it('drops an oversized referrer instead of parsing it', () => {
    const oversized = `https://example.com/${'a'.repeat(2100)}`;
    assert.equal(parseReferrerHost(oversized, OWN), null);
  });

  it('truncates a stored hostname to 200 characters', () => {
    const hostname = `${'a'.repeat(210)}.com`;
    const result = parseReferrerHost(`https://${hostname}/x`, OWN);
    assert.equal(result?.length, 200);
  });
});

describe('duplicate suppression (#9)', () => {
  it('uses a 30-second SQLite window', () => {
    assert.equal(duplicateWindowModifier(), '-30 seconds');
    assert.equal(duplicateWindowModifier(60), '-60 seconds');
    assert.match(duplicateVisitQuery(), /visitor_hash = \? AND path = \?/);
    assert.match(duplicateVisitQuery(), /datetime\('now', \?\)/);
  });

  it('detects a row written inside the window', async () => {
    const { db, calls } = fakeDatabase([{ id: 1 }]);
    assert.equal(await isDuplicateVisit(db, 'hash', '/posts'), true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].values, ['hash', '/posts', '-30 seconds']);
  });

  it('reports no duplicate when the query returns nothing', async () => {
    const { db } = fakeDatabase([null]);
    assert.equal(await isDuplicateVisit(db, 'hash', '/posts'), false);
  });
});

describe('retention (#8)', () => {
  it('cuts off rows at the 180-day window', () => {
    assert.equal(visitRetentionModifier(), '-180 days');
    assert.equal(visitRetentionModifier(7), '-7 days');
    assert.match(visitRetentionQuery(), /^DELETE FROM visits WHERE created_at </);
  });

  it('formats a UTC calendar day', () => {
    assert.equal(utcDay(Date.UTC(2026, 10, 11, 23, 59, 59)), '2026-11-11');
  });

  it('zero-fills days without visits so the trend always spans the window', () => {
    const now = Date.UTC(2026, 10, 8, 3, 0, 0);
    const filled = fillDailyGaps([{ day: '2026-11-06', views: 4, uniqueVisitors: 2 }], now, 4);
    assert.deepEqual(
      filled.map((d) => [d.day, d.views]),
      [
        ['2026-11-05', 0],
        ['2026-11-06', 4],
        ['2026-11-07', 0],
        ['2026-11-08', 0],
      ],
    );
    assert.equal(fillDailyGaps([], now).length, 30);
  });

  it('runs at most once per isolate per UTC day, then only by chance', () => {
    const now = Date.UTC(2026, 10, 11, 12, 0, 0);

    // Never attempted before: the chance decides.
    assert.equal(shouldAttemptVisitCleanup({ random: 0.005, now, lastAttemptAt: 0 }), true);
    assert.equal(shouldAttemptVisitCleanup({ random: 0.5, now, lastAttemptAt: 0 }), false);

    // Already attempted today: never again, even with random 0.
    const sameDay = shouldAttemptVisitCleanup({ random: 0, now, lastAttemptAt: now - 60 * 60 * 1000 });
    assert.equal(sameDay, false);

    // Previous day: eligible again.
    const previousDay = now - 24 * 60 * 60 * 1000;
    assert.equal(shouldAttemptVisitCleanup({ random: 0, now, lastAttemptAt: previousDay }), true);

    // The chance is injectable so tests do not depend on the production value.
    assert.equal(shouldAttemptVisitCleanup({ random: 0.4, now, lastAttemptAt: 0, chance: 0.5 }), true);
    assert.equal(shouldAttemptVisitCleanup({ random: 0.6, now, lastAttemptAt: 0, chance: 0.5 }), false);
  });
});
