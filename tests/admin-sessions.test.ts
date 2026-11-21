import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseAdminSessionCookie } from '../src/lib/auth-crypto.ts';
import {
  ADMIN_SESSION_TOUCH_INTERVAL_SECONDS,
  ADMIN_SESSION_TTL_SECONDS,
  adminSessionGuard,
  cleanupExpiredAdminSessions,
  createAdminSession,
  generateAdminSessionId,
  lookupAdminSession,
  revokeAdminSession,
  revokeAllAdminSessions,
  shouldTouchAdminSession,
  touchAdminSession,
  type AdminSessionDb,
  type AdminSessionRow,
  type AdminSessionStatement,
} from '../src/lib/admin-sessions-core.ts';

const SECRET = 'test-admin-session-secret-do-not-use';
const NOW = 1_800_000_000;

/**
 * In-memory stand-in for the exact D1 queries admin-sessions-core.ts issues.
 * Any unknown query fails loudly, so a SQL change forces this fake to be
 * updated instead of silently making a test vacuous.
 */
class FakeAdminSessionDb implements AdminSessionDb {
  rows = new Map<string, AdminSessionRow>();
  failError: Error | null = null;
  queries: string[] = [];

  prepare(query: string): AdminSessionStatement {
    const sql = query.replace(/\s+/g, ' ').trim();
    const values: unknown[] = [];
    this.queries.push(sql);
    const db = this;

    const statement: AdminSessionStatement = {
      bind(...bound: unknown[]) {
        values.push(...bound);
        return statement;
      },
      async first<T = Record<string, unknown>>(): Promise<T | null> {
        db.throwIfFailing();
        if (sql.startsWith('SELECT session_id')) {
          const row = db.rows.get(String(values[0]));
          return (row ? { ...row } : null) as T | null;
        }
        throw new Error(`Unexpected first() query: ${sql}`);
      },
      async run(): Promise<unknown> {
        db.throwIfFailing();
        if (sql.startsWith('INSERT INTO admin_sessions')) {
          const [sessionId, createdAt, expiresAt, lastSeenAt] = values as [string, number, number, number];
          db.rows.set(sessionId, {
            session_id: sessionId,
            created_at: createdAt,
            expires_at: expiresAt,
            revoked_at: null,
            last_seen_at: lastSeenAt,
          });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith('UPDATE admin_sessions SET revoked_at = ? WHERE session_id = ?')) {
          const [revokedAt, sessionId] = values as [number, string];
          const row = db.rows.get(sessionId);
          const changes = row && row.revoked_at == null ? 1 : 0;
          if (row && row.revoked_at == null) row.revoked_at = revokedAt;
          return { meta: { changes } };
        }
        if (sql.startsWith('UPDATE admin_sessions SET revoked_at = ? WHERE revoked_at IS NULL')) {
          const [revokedAt] = values as [number];
          let changes = 0;
          for (const row of db.rows.values()) {
            if (row.revoked_at == null) {
              row.revoked_at = revokedAt;
              changes += 1;
            }
          }
          return { meta: { changes } };
        }
        if (sql.startsWith('UPDATE admin_sessions SET last_seen_at = ?')) {
          const [lastSeenAt, sessionId] = values as [number, string];
          const row = db.rows.get(sessionId);
          if (!row) return { meta: { changes: 0 } };
          row.last_seen_at = lastSeenAt;
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith('DELETE FROM admin_sessions WHERE expires_at <= ?')) {
          const [now] = values as [number];
          let changes = 0;
          for (const [sessionId, row] of db.rows) {
            if (row.expires_at <= now) {
              db.rows.delete(sessionId);
              changes += 1;
            }
          }
          return { meta: { changes } };
        }
        throw new Error(`Unexpected run() query: ${sql}`);
      },
    };

    return statement;
  }

  throwIfFailing(): void {
    if (this.failError) throw this.failError;
  }
}

describe('admin session ids', () => {
  it('are 32 base64url characters and never repeat', () => {
    const ids = new Set<string>();
    for (let index = 0; index < 50; index += 1) ids.add(generateAdminSessionId());
    assert.equal(ids.size, 50);
    for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{32}$/);
  });
});

describe('createAdminSession', () => {
  it('inserts an active seven-day row and a cookie that parses back to it', async () => {
    const db = new FakeAdminSessionDb();
    const created = await createAdminSession(db, SECRET, NOW);

    const row = db.rows.get(created.sessionId);
    assert.ok(row, 'the session row must exist');
    assert.equal(row.created_at, NOW);
    assert.equal(row.expires_at, NOW + ADMIN_SESSION_TTL_SECONDS);
    assert.equal(row.expires_at, created.expiresAt);
    assert.equal(row.revoked_at, null);
    assert.equal(row.last_seen_at, NOW);

    assert.deepEqual(await parseAdminSessionCookie(SECRET, created.cookieValue, ADMIN_SESSION_TTL_SECONDS, NOW), {
      sessionId: created.sessionId,
      issuedAt: NOW,
    });
  });
});

describe('lookupAdminSession', () => {
  it('returns ok for a live session', async () => {
    const db = new FakeAdminSessionDb();
    const created = await createAdminSession(db, SECRET, NOW);
    const result = await lookupAdminSession(db, SECRET, created.cookieValue, NOW + 10);
    assert.equal(result.status, 'ok');
    assert.equal(result.status === 'ok' ? result.row.session_id : null, created.sessionId);
  });

  it('returns unauthenticated for a tampered cookie without touching D1', async () => {
    const db = new FakeAdminSessionDb();
    const created = await createAdminSession(db, SECRET, NOW);
    db.queries.length = 0;

    const tampered = `${created.cookieValue.split('.').slice(0, 2).join('.')}.${'A'.repeat(43)}`;
    assert.deepEqual(await lookupAdminSession(db, SECRET, tampered, NOW), { status: 'unauthenticated' });
    assert.deepEqual(db.queries, []);
  });

  it('returns unauthenticated for an unknown, revoked or expired row', async () => {
    const unknownDb = new FakeAdminSessionDb();
    const unknown = await createAdminSession(unknownDb, SECRET, NOW);
    unknownDb.rows.delete(unknown.sessionId);
    assert.deepEqual(await lookupAdminSession(unknownDb, SECRET, unknown.cookieValue, NOW), {
      status: 'unauthenticated',
    });

    const revokedDb = new FakeAdminSessionDb();
    const revoked = await createAdminSession(revokedDb, SECRET, NOW);
    await revokeAdminSession(revokedDb, revoked.sessionId, NOW + 1);
    assert.deepEqual(await lookupAdminSession(revokedDb, SECRET, revoked.cookieValue, NOW + 2), {
      status: 'unauthenticated',
    });

    // D1-side expiry only: the cookie itself is still inside its 7-day window.
    const expiredDb = new FakeAdminSessionDb();
    const expired = await createAdminSession(expiredDb, SECRET, NOW);
    const row = expiredDb.rows.get(expired.sessionId);
    assert.ok(row);
    row.expires_at = NOW + 10;
    assert.deepEqual(await lookupAdminSession(expiredDb, SECRET, expired.cookieValue, NOW + 20), {
      status: 'unauthenticated',
    });
  });

  it('returns unavailable (never ok, never unauthenticated) when D1 fails or the table is missing', async () => {
    const db = new FakeAdminSessionDb();
    const created = await createAdminSession(db, SECRET, NOW);
    db.failError = new Error('D1_ERROR: no such table: admin_sessions');
    assert.deepEqual(await lookupAdminSession(db, SECRET, created.cookieValue, NOW), { status: 'unavailable' });
    db.failError = new Error('D1_ERROR: network unavailable');
    assert.deepEqual(await lookupAdminSession(db, SECRET, created.cookieValue, NOW), { status: 'unavailable' });
  });
});

describe('session touch / revoke / cleanup', () => {
  it('only touches last_seen_at after the throttle interval', async () => {
    const row: AdminSessionRow = {
      session_id: 'a'.repeat(32),
      created_at: NOW,
      expires_at: NOW + ADMIN_SESSION_TTL_SECONDS,
      revoked_at: null,
      last_seen_at: NOW,
    };
    assert.equal(shouldTouchAdminSession(row, NOW), false);
    assert.equal(shouldTouchAdminSession(row, NOW + ADMIN_SESSION_TOUCH_INTERVAL_SECONDS - 1), false);
    assert.equal(shouldTouchAdminSession(row, NOW + ADMIN_SESSION_TOUCH_INTERVAL_SECONDS), true);
    assert.equal(shouldTouchAdminSession({ ...row, last_seen_at: null }, NOW), true);

    const db = new FakeAdminSessionDb();
    const created = await createAdminSession(db, SECRET, NOW);
    await touchAdminSession(db, created.sessionId, NOW + 600);
    assert.equal(db.rows.get(created.sessionId)?.last_seen_at, NOW + 600);
  });

  it('revokes one session idempotently', async () => {
    const db = new FakeAdminSessionDb();
    const created = await createAdminSession(db, SECRET, NOW);
    await revokeAdminSession(db, created.sessionId, NOW + 1);
    assert.equal(db.rows.get(created.sessionId)?.revoked_at, NOW + 1);
    await revokeAdminSession(db, created.sessionId, NOW + 2);
    assert.equal(db.rows.get(created.sessionId)?.revoked_at, NOW + 1);
  });

  it('revokes every active session for logout-all', async () => {
    const db = new FakeAdminSessionDb();
    const first = await createAdminSession(db, SECRET, NOW);
    const second = await createAdminSession(db, SECRET, NOW);
    assert.notEqual(first.sessionId, second.sessionId);

    await revokeAllAdminSessions(db, NOW + 5);
    for (const row of db.rows.values()) assert.equal(row.revoked_at, NOW + 5);

    // A newly created session after logout-all is active again.
    const third = await createAdminSession(db, SECRET, NOW + 6);
    assert.equal(db.rows.get(third.sessionId)?.revoked_at, null);
  });

  it('cleanup deletes only expired rows', async () => {
    const db = new FakeAdminSessionDb();
    const live = await createAdminSession(db, SECRET, NOW);
    const stale = await createAdminSession(db, SECRET, NOW - ADMIN_SESSION_TTL_SECONDS - 1);
    await cleanupExpiredAdminSessions(db, NOW);
    assert.ok(db.rows.has(live.sessionId));
    assert.equal(db.rows.has(stale.sessionId), false);
  });
});

describe('adminSessionGuard (#16)', () => {
  const row: AdminSessionRow = {
    session_id: 'a'.repeat(32),
    created_at: NOW,
    expires_at: NOW + ADMIN_SESSION_TTL_SECONDS,
    revoked_at: null,
    last_seen_at: NOW,
  };

  it('allows an active session and hands back its row', () => {
    assert.deepEqual(adminSessionGuard({ status: 'ok', row }), { allow: true, row });
  });

  it('maps an invalid/expired/revoked session to 401, not 503', () => {
    assert.deepEqual(adminSessionGuard({ status: 'unauthenticated' }), {
      allow: false,
      status: 401,
      error: 'Not authenticated.',
    });
  });

  it('maps a D1 outage or pending migration to 503, never to 401', () => {
    const guard = adminSessionGuard({ status: 'unavailable' });
    assert.equal(guard.allow, false);
    assert.equal(guard.allow === false ? guard.status : null, 503);
    assert.match(guard.allow === false ? guard.error : '', /storage is unavailable/);
  });
});
