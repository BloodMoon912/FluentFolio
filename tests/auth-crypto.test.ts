import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ADMIN_SESSION_ID_PATTERN,
  CLOCK_SKEW_SECONDS,
  base64UrlDecode,
  base64UrlEncode,
  expiredCookie,
  parseAdminSessionCookie,
  payloadFor,
  readCookie,
  serializeCookie,
  signAdminSession,
  signIssuedAt,
  timingSafeEqual,
  verifyIssuedAt,
} from '../src/lib/auth-crypto.ts';

const SECRET = 'test-secret-do-not-use-in-production';
const MAX_AGE = 60 * 60 * 24 * 7;
const NOW = 1_800_000_000;

function requestWithCookie(cookie: string | null): Request {
  return new Request('https://example.com/', cookie === null ? {} : { headers: { Cookie: cookie } });
}

describe('base64url', () => {
  it('round-trips bytes that exercise both the + and / alphabets', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xfe, 0x00, 0x10, 0x83, 0x7f]);
    assert.deepEqual(base64UrlDecode(base64UrlEncode(bytes)), bytes);
  });

  it('emits no padding and no URL-unsafe characters', () => {
    const encoded = base64UrlEncode(new Uint8Array([1, 2, 3, 4, 5]));
    assert.equal(encoded.includes('='), false);
    assert.equal(encoded.includes('+'), false);
    assert.equal(encoded.includes('/'), false);
  });
});

describe('payloadFor', () => {
  it('signs the bare timestamp when no scope is given', () => {
    assert.equal(payloadFor('123'), '123');
  });

  it('prefixes the scope when one is given', () => {
    assert.equal(payloadFor('123', 'admin'), 'admin.123');
  });
});

describe('readCookie', () => {
  it('finds a cookie among several', () => {
    assert.equal(readCookie(requestWithCookie('a=1; __Host-bm-visit=42.sig; b=2'), '__Host-bm-visit'), '42.sig');
  });

  it('returns null when the header is absent or the name does not match', () => {
    assert.equal(readCookie(requestWithCookie(null), '__Host-bm-visit'), null);
    assert.equal(readCookie(requestWithCookie('other=1'), '__Host-bm-visit'), null);
  });
});

describe('signIssuedAt / verifyIssuedAt', () => {
  it('accepts a freshly signed value', async () => {
    const raw = await signIssuedAt(SECRET, NOW);
    assert.equal(await verifyIssuedAt(SECRET, raw, MAX_AGE, '', NOW), true);
  });

  it('rejects a value signed with a different secret', async () => {
    const raw = await signIssuedAt(SECRET, NOW);
    assert.equal(await verifyIssuedAt('another-secret', raw, MAX_AGE, '', NOW), false);
  });

  it('rejects a tampered signature', async () => {
    const raw = await signIssuedAt(SECRET, NOW);
    const [issuedAt, signature] = raw.split('.');
    const flipped = `${signature.slice(0, -1)}${signature.at(-1) === 'A' ? 'B' : 'A'}`;
    assert.equal(await verifyIssuedAt(SECRET, `${issuedAt}.${flipped}`, MAX_AGE, '', NOW), false);
  });

  it('rejects a tampered timestamp even though the signature is well formed', async () => {
    const raw = await signIssuedAt(SECRET, NOW);
    const signature = raw.split('.')[1];
    assert.equal(await verifyIssuedAt(SECRET, `${NOW + 1}.${signature}`, MAX_AGE, '', NOW), false);
  });

  it('rejects a value older than maxAge', async () => {
    const raw = await signIssuedAt(SECRET, NOW - MAX_AGE - 1);
    assert.equal(await verifyIssuedAt(SECRET, raw, MAX_AGE, '', NOW), false);
  });

  it('accepts a value inside the skew window and rejects one beyond it', async () => {
    const insideSkew = await signIssuedAt(SECRET, NOW + CLOCK_SKEW_SECONDS);
    const beyondSkew = await signIssuedAt(SECRET, NOW + CLOCK_SKEW_SECONDS + 1);
    assert.equal(await verifyIssuedAt(SECRET, insideSkew, MAX_AGE, '', NOW), true);
    assert.equal(await verifyIssuedAt(SECRET, beyondSkew, MAX_AGE, '', NOW), false);
  });

  it('rejects malformed values without throwing', async () => {
    for (const raw of ['', 'no-dot', '.sig', '123.', 'abc.sig', '1.2']) {
      assert.equal(await verifyIssuedAt(SECRET, raw, MAX_AGE, '', NOW), false, `should reject "${raw}"`);
    }
  });

  it('keeps scopes separate, so a visitor token never validates as an admin session', async () => {
    const visitorToken = await signIssuedAt(SECRET, NOW);
    const adminToken = await signIssuedAt(SECRET, NOW, 'admin');
    assert.equal(await verifyIssuedAt(SECRET, visitorToken, MAX_AGE, 'admin', NOW), false);
    assert.equal(await verifyIssuedAt(SECRET, adminToken, MAX_AGE, '', NOW), false);
    assert.equal(await verifyIssuedAt(SECRET, adminToken, MAX_AGE, 'admin', NOW), true);
  });

  it('rejects everything when the secret is empty', async () => {
    const raw = await signIssuedAt(SECRET, NOW);
    assert.equal(await verifyIssuedAt('', raw, MAX_AGE, '', NOW), false);
  });
});

describe('admin session cookie (#13)', () => {
  // 24 random bytes encode to 32 base64url characters.
  const SESSION_ID = 'abcdefghijklmnopqrstuvwxyz012345';

  it('signs a three-part <sessionId>.<issuedAt>.<signature> value', async () => {
    const raw = await signAdminSession(SECRET, SESSION_ID, NOW);
    const parts = raw.split('.');
    assert.equal(parts.length, 3);
    assert.equal(parts[0], SESSION_ID);
    assert.equal(parts[1], String(NOW));
    assert.match(SESSION_ID, ADMIN_SESSION_ID_PATTERN);
  });

  it('round-trips through parseAdminSessionCookie', async () => {
    const raw = await signAdminSession(SECRET, SESSION_ID, NOW);
    assert.deepEqual(await parseAdminSessionCookie(SECRET, raw, MAX_AGE, NOW), {
      sessionId: SESSION_ID,
      issuedAt: NOW,
    });
  });

  it('rejects a different secret, a tampered session id and a tampered timestamp', async () => {
    const raw = await signAdminSession(SECRET, SESSION_ID, NOW);
    const [sessionId, issuedAt, signature] = raw.split('.');

    assert.equal(await parseAdminSessionCookie('another-secret', raw, MAX_AGE, NOW), null);
    assert.equal(
      await parseAdminSessionCookie(SECRET, `${'z'.repeat(32)}.${issuedAt}.${signature}`, MAX_AGE, NOW),
      null,
    );
    assert.equal(await parseAdminSessionCookie(SECRET, `${sessionId}.${NOW + 1}.${signature}`, MAX_AGE, NOW), null);
  });

  it('rejects every pre-#13 two-part cookie, even a valid old admin token', async () => {
    const oldCookie = await signIssuedAt(SECRET, NOW, 'admin');
    assert.equal(oldCookie.split('.').length, 2);
    assert.equal(await parseAdminSessionCookie(SECRET, oldCookie, MAX_AGE, NOW), null);
    // And the new format is not accepted by the old verifier either.
    const newCookie = await signAdminSession(SECRET, SESSION_ID, NOW);
    assert.equal(await verifyIssuedAt(SECRET, newCookie, MAX_AGE, 'admin', NOW), false);
  });

  it('rejects malformed session ids and values without throwing', async () => {
    const raw = await signAdminSession(SECRET, SESSION_ID, NOW);
    const signature = raw.split('.')[2];
    for (const candidate of [
      '',
      'no-dot',
      `${SESSION_ID}.${NOW}`,
      `${SESSION_ID}.${NOW}.${signature}.extra`,
      `${'a'.repeat(31)}.${NOW}.${signature}`,
      `${'a'.repeat(33)}.${NOW}.${signature}`,
      `${'a'.repeat(31)}!.${NOW}.${signature}`,
      `${SESSION_ID}.abc.${signature}`,
    ]) {
      assert.equal(
        await parseAdminSessionCookie(SECRET, candidate, MAX_AGE, NOW),
        null,
        `should reject "${candidate}"`,
      );
    }
  });

  it('enforces the age window and clock-skew window', async () => {
    const fresh = await signAdminSession(SECRET, SESSION_ID, NOW);
    assert.equal(await parseAdminSessionCookie(SECRET, fresh, MAX_AGE, NOW + MAX_AGE + 1), null);
    // A cookie from the near future is tolerated only inside the skew window.
    assert.notEqual(await parseAdminSessionCookie(SECRET, fresh, MAX_AGE, NOW - CLOCK_SKEW_SECONDS), null);
    assert.equal(await parseAdminSessionCookie(SECRET, fresh, MAX_AGE, NOW - CLOCK_SKEW_SECONDS - 1), null);

    const insideSkew = await signAdminSession(SECRET, SESSION_ID, NOW + CLOCK_SKEW_SECONDS);
    const beyondSkew = await signAdminSession(SECRET, SESSION_ID, NOW + CLOCK_SKEW_SECONDS + 1);
    assert.notEqual(await parseAdminSessionCookie(SECRET, insideSkew, MAX_AGE, NOW), null);
    assert.equal(await parseAdminSessionCookie(SECRET, beyondSkew, MAX_AGE, NOW), null);
  });

  it('rejects everything when the secret is empty', async () => {
    const raw = await signAdminSession(SECRET, SESSION_ID, NOW);
    assert.equal(await parseAdminSessionCookie('', raw, MAX_AGE, NOW), null);
  });
});

describe('cookie serialization', () => {
  it('always emits the __Host- compatible attribute set', () => {
    const value = serializeCookie('__Host-bm-visit', '1.sig', 100);
    assert.equal(value, '__Host-bm-visit=1.sig; Path=/; Max-Age=100; HttpOnly; Secure; SameSite=Lax');
    assert.equal(value.includes('Domain='), false);
  });

  it('expires a cookie by setting Max-Age=0', () => {
    assert.equal(
      expiredCookie('__Host-bm-admin'),
      '__Host-bm-admin=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
    );
  });
});

describe('timingSafeEqual', () => {
  it('matches identical strings', () => {
    assert.equal(timingSafeEqual('hunter2', 'hunter2'), true);
  });

  it('rejects different strings and different lengths', () => {
    assert.equal(timingSafeEqual('hunter2', 'hunter3'), false);
    assert.equal(timingSafeEqual('hunter2', 'hunter22'), false);
  });

  it('does not throw on multi-byte input', () => {
    assert.equal(timingSafeEqual('密碼', '密碼'), true);
    assert.equal(timingSafeEqual('密碼', '密碼x'), false);
  });
});
