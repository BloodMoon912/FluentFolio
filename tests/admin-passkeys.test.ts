import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ADMIN_CHALLENGE_CLOCK_SKEW_SECONDS,
  ADMIN_CHALLENGE_ID_PATTERN,
  ADMIN_CHALLENGE_TTL_SECONDS,
  generateChallengeId,
  parseChallengeCookie,
  signChallengeCookie,
} from '../src/lib/admin-passkeys-core.ts';
import { base64UrlDecode, base64UrlEncode } from '../src/lib/auth-crypto.ts';

const SECRET = 'test-challenge-secret-do-not-use';
const NOW = 1_800_000_000;
const ID = 'abcdefghijklmnopqrstuvwxyz012345'; // 32 base64url characters

function payloadPartOf(cookie: string): string {
  return cookie.split('.')[0];
}

function signaturePartOf(cookie: string): string {
  return cookie.split('.')[1];
}

function encodePayload(payload: string): string {
  return base64UrlEncode(new TextEncoder().encode(payload));
}

/** Build a validly signed cookie for an arbitrary payload (to test validation only). */
async function signRawPayload(payload: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${encodePayload(payload)}.${base64UrlEncode(new Uint8Array(signature))}`;
}

describe('generateChallengeId', () => {
  it('returns 32 characters and never repeats', () => {
    const ids = new Set<string>();
    for (let index = 0; index < 50; index += 1) ids.add(generateChallengeId());
    assert.equal(ids.size, 50);
    for (const id of ids) assert.match(id, ADMIN_CHALLENGE_ID_PATTERN);
  });
});

describe('signChallengeCookie / parseChallengeCookie', () => {
  it('round-trips a login challenge', async () => {
    const cookie = await signChallengeCookie(SECRET, 'login', ID, NOW);
    assert.equal(await parseChallengeCookie(SECRET, cookie, 'login', NOW), ID);
  });

  it('round-trips a register challenge', async () => {
    const cookie = await signChallengeCookie(SECRET, 'register', ID, NOW);
    assert.equal(await parseChallengeCookie(SECRET, cookie, 'register', NOW), ID);
  });

  it('emits the documented two-part wire format', async () => {
    const cookie = await signChallengeCookie(SECRET, 'login', ID, NOW);
    const parts = cookie.split('.');
    assert.equal(parts.length, 2);
    assert.equal(new TextDecoder().decode(base64UrlDecode(payloadPartOf(cookie))), `login\n${ID}\n${NOW}`);
    assert.ok(signaturePartOf(cookie).length > 0);
  });

  it('rejects a challenge issued for the other purpose', async () => {
    const loginCookie = await signChallengeCookie(SECRET, 'login', ID, NOW);
    const registerCookie = await signChallengeCookie(SECRET, 'register', ID, NOW);
    assert.equal(await parseChallengeCookie(SECRET, loginCookie, 'register', NOW), null);
    assert.equal(await parseChallengeCookie(SECRET, registerCookie, 'login', NOW), null);
  });

  it('rejects a cookie signed with a different secret', async () => {
    const cookie = await signChallengeCookie('a-different-secret', 'login', ID, NOW);
    assert.equal(await parseChallengeCookie(SECRET, cookie, 'login', NOW), null);
  });

  it('rejects a tampered signature', async () => {
    const cookie = await signChallengeCookie(SECRET, 'login', ID, NOW);
    const signature = signaturePartOf(cookie);
    const flipped = `${signature.slice(0, -1)}${signature.at(-1) === 'A' ? 'B' : 'A'}`;
    assert.equal(await parseChallengeCookie(SECRET, `${payloadPartOf(cookie)}.${flipped}`, 'login', NOW), null);
  });

  it('rejects a tampered payload even when the signature is well formed', async () => {
    const cookie = await signChallengeCookie(SECRET, 'login', ID, NOW);
    const tamperedId = `${ID.slice(0, -1)}${ID.at(-1) === 'a' ? 'b' : 'a'}`;
    const tamperedPayload = encodePayload(`login\n${tamperedId}\n${NOW}`);
    assert.equal(
      await parseChallengeCookie(SECRET, `${tamperedPayload}.${signaturePartOf(cookie)}`, 'login', NOW),
      null,
    );
  });

  it('rejects extra, missing or empty parts', async () => {
    const cookie = await signChallengeCookie(SECRET, 'login', ID, NOW);
    for (const candidate of [
      `${cookie}.extra`,
      payloadPartOf(cookie),
      `.${signaturePartOf(cookie)}`,
      `${payloadPartOf(cookie)}.`,
      'not-a-cookie',
      '',
    ]) {
      assert.equal(await parseChallengeCookie(SECRET, candidate, 'login', NOW), null, `should reject "${candidate}"`);
    }
  });

  it('rejects malformed payloads and invalid base64 without throwing', async () => {
    for (const candidate of [
      '!!!.signature',
      `${encodePayload('login')}.signature`,
      `${encodePayload(`login\n${ID}`)}.signature`,
      `${encodePayload(`login\n${ID}\n${NOW}\nextra`)}.signature`,
      `${encodePayload(`login\n${ID}\nnot-a-number`)}.signature`,
      `${encodePayload(`other\n${ID}\n${NOW}`)}.signature`,
    ]) {
      assert.equal(await parseChallengeCookie(SECRET, candidate, 'login', NOW), null, `should reject "${candidate}"`);
    }
  });

  it('rejects an id that is not 32 base64url characters, even with a valid signature', async () => {
    for (const badId of ['short', 'a'.repeat(31), 'a'.repeat(33), `${'a'.repeat(31)}!`]) {
      const cookie = await signChallengeCookie(SECRET, 'login', badId, NOW);
      assert.equal(await parseChallengeCookie(SECRET, cookie, 'login', NOW), null, `should reject id "${badId}"`);
    }
  });

  it('enforces the five-minute TTL boundary', async () => {
    const cookie = await signChallengeCookie(SECRET, 'login', ID, NOW);
    assert.equal(await parseChallengeCookie(SECRET, cookie, 'login', NOW + ADMIN_CHALLENGE_TTL_SECONDS), ID);
    assert.equal(await parseChallengeCookie(SECRET, cookie, 'login', NOW + ADMIN_CHALLENGE_TTL_SECONDS + 1), null);
  });

  it('accepts only inside the clock-skew window for future issue times', async () => {
    const inside = await signChallengeCookie(SECRET, 'login', ID, NOW + ADMIN_CHALLENGE_CLOCK_SKEW_SECONDS);
    const beyond = await signChallengeCookie(SECRET, 'login', ID, NOW + ADMIN_CHALLENGE_CLOCK_SKEW_SECONDS + 1);
    assert.equal(await parseChallengeCookie(SECRET, inside, 'login', NOW), ID);
    assert.equal(await parseChallengeCookie(SECRET, beyond, 'login', NOW), null);
  });

  it('rejects cookies longer than the 512-character cap', async () => {
    assert.equal(await parseChallengeCookie(SECRET, 'a'.repeat(513), 'login', NOW), null);
  });

  it('fails closed for a missing/empty secret or cookie', async () => {
    const cookie = await signChallengeCookie(SECRET, 'login', ID, NOW);
    assert.equal(await parseChallengeCookie('', cookie, 'login', NOW), null);
    assert.equal(await parseChallengeCookie(SECRET, '', 'login', NOW), null);
    assert.equal(await parseChallengeCookie(SECRET, null, 'login', NOW), null);
    assert.equal(await parseChallengeCookie(null, cookie, 'login', NOW), null);
  });

  it('rejects old or foreign cookie shapes', async () => {
    // A dot-separated value (e.g. the pre-#13 admin session format) has 3 parts.
    assert.equal(await parseChallengeCookie(SECRET, `${ID}.${NOW}.signature`, 'login', NOW), null);
    // A two-part value whose payload is not a purpose/id/timestamp triple.
    assert.equal(await parseChallengeCookie(SECRET, await signRawPayload(`${NOW}`), 'login', NOW), null);
  });
});
