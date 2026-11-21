import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TURNSTILE_VERIFY_URL,
  judgeTurnstileOutcome,
  parseHostnameList,
  verifyTurnstileToken,
} from '../src/lib/turnstile.ts';

const SECRET = 'test-secret';
const HOSTS = ['www.example.com', 'example.com'];

/** Minimal fake of the siteverify endpoint. */
function fakeFetch(payload: unknown, init: { status?: number; throw?: boolean } = {}) {
  const calls: Array<{ url: string; body: URLSearchParams }> = [];
  const impl = (async (url: unknown, requestInit?: RequestInit) => {
    if (init.throw) throw new Error('network down');
    calls.push({ url: String(url), body: new URLSearchParams(String(requestInit?.body ?? '')) });
    return new Response(JSON.stringify(payload), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('parseHostnameList', () => {
  it('splits, trims and drops blanks', () => {
    assert.deepEqual(parseHostnameList(' a.com , b.com ,, '), ['a.com', 'b.com']);
  });

  it('returns an empty list for missing input', () => {
    assert.deepEqual(parseHostnameList(undefined), []);
    assert.deepEqual(parseHostnameList(''), []);
  });
});

describe('judgeTurnstileOutcome', () => {
  it('accepts a successful token for the expected action and hostname', () => {
    assert.deepEqual(judgeTurnstileOutcome({ success: true, action: 'visit', hostname: 'a.com' }, 'visit', ['a.com']), {
      ok: true,
    });
  });

  it('rejects a payload that is not an object', () => {
    assert.deepEqual(judgeTurnstileOutcome(null, 'visit', []), { ok: false, reason: 'verification-failed' });
    assert.deepEqual(judgeTurnstileOutcome('nope', 'visit', []), { ok: false, reason: 'verification-failed' });
  });

  it('rejects success: false', () => {
    assert.deepEqual(judgeTurnstileOutcome({ success: false }, 'visit', []), {
      ok: false,
      reason: 'verification-failed',
    });
  });

  it('rejects a token minted for a different action', () => {
    assert.deepEqual(judgeTurnstileOutcome({ success: true, action: 'comment' }, 'visit', []), {
      ok: false,
      reason: 'action-mismatch',
    });
  });

  it('accepts any action when none is expected', () => {
    assert.deepEqual(judgeTurnstileOutcome({ success: true, action: 'anything', hostname: 'a.com' }, '', ['a.com']), {
      ok: true,
    });
  });

  it('rejects a hostname outside a non-empty allow-list', () => {
    assert.deepEqual(
      judgeTurnstileOutcome({ success: true, action: 'visit', hostname: 'evil.com' }, 'visit', ['a.com']),
      { ok: false, reason: 'hostname-mismatch' },
    );
  });

  it('fails closed when the allow-list is not configured', () => {
    // Canonical contract: an empty TURNSTILE_HOSTNAMES is a configuration error,
    // not an "accept anything" pass. Failing closed is affordable here only
    // because the client cannot loop on a rejection.
    assert.deepEqual(judgeTurnstileOutcome({ success: true, action: 'visit', hostname: 'anything.dev' }, 'visit', []), {
      ok: false,
      reason: 'hostnames-not-configured',
    });
  });

  it('rejects a payload with no hostname when a list is configured', () => {
    assert.deepEqual(judgeTurnstileOutcome({ success: true, action: 'visit' }, 'visit', ['a.com']), {
      ok: false,
      reason: 'hostname-mismatch',
    });
  });
});

describe('verifyTurnstileToken', () => {
  it('reports not-configured when there is no secret, without calling siteverify', async () => {
    const { impl, calls } = fakeFetch({ success: true });
    const outcome = await verifyTurnstileToken({
      token: 'x',
      remoteip: '1.2.3.4',
      expectedAction: 'visit',
      secret: undefined,
      allowedHostnames: [],
      fetchImpl: impl,
    });
    assert.deepEqual(outcome, { ok: false, reason: 'not-configured' });
    assert.equal(calls.length, 0);
  });

  it('reports missing-token for an absent or empty token', async () => {
    for (const token of [undefined, null, '', 42]) {
      const { impl } = fakeFetch({ success: true });
      const outcome = await verifyTurnstileToken({
        token,
        remoteip: '1.2.3.4',
        expectedAction: 'visit',
        secret: SECRET,
        allowedHostnames: [],
        fetchImpl: impl,
      });
      assert.deepEqual(outcome, { ok: false, reason: 'missing-token' }, `token=${String(token)}`);
    }
  });

  it('reports malformed-token for an over-long token', async () => {
    const { impl, calls } = fakeFetch({ success: true });
    const outcome = await verifyTurnstileToken({
      token: 'x'.repeat(2049),
      remoteip: '1.2.3.4',
      expectedAction: 'visit',
      secret: SECRET,
      allowedHostnames: [],
      fetchImpl: impl,
    });
    assert.deepEqual(outcome, { ok: false, reason: 'malformed-token' });
    assert.equal(calls.length, 0);
  });

  it('posts the secret, token and remote IP to siteverify', async () => {
    const { impl, calls } = fakeFetch({ success: true, action: 'visit', hostname: 'a.com' });
    await verifyTurnstileToken({
      token: 'tok',
      remoteip: '1.2.3.4',
      expectedAction: 'visit',
      secret: SECRET,
      allowedHostnames: HOSTS,
      fetchImpl: impl,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, TURNSTILE_VERIFY_URL);
    assert.equal(calls[0].body.get('secret'), SECRET);
    assert.equal(calls[0].body.get('response'), 'tok');
    assert.equal(calls[0].body.get('remoteip'), '1.2.3.4');
  });

  it('passes a good siteverify payload through judgeTurnstileOutcome', async () => {
    const { impl } = fakeFetch({ success: true, action: 'visit', hostname: 'www.example.com' });
    const outcome = await verifyTurnstileToken({
      token: 'tok',
      remoteip: '1.2.3.4',
      expectedAction: 'visit',
      secret: SECRET,
      allowedHostnames: HOSTS,
      fetchImpl: impl,
    });
    assert.deepEqual(outcome, { ok: true });
  });

  it('maps a non-2xx siteverify response to network-error', async () => {
    const { impl } = fakeFetch({ success: true }, { status: 500 });
    const outcome = await verifyTurnstileToken({
      token: 'tok',
      remoteip: '1.2.3.4',
      expectedAction: 'visit',
      secret: SECRET,
      allowedHostnames: [],
      fetchImpl: impl,
    });
    assert.deepEqual(outcome, { ok: false, reason: 'network-error' });
  });

  it('maps a thrown fetch to network-error instead of propagating', async () => {
    const { impl } = fakeFetch({}, { throw: true });
    const outcome = await verifyTurnstileToken({
      token: 'tok',
      remoteip: '1.2.3.4',
      expectedAction: 'visit',
      secret: SECRET,
      allowedHostnames: [],
      fetchImpl: impl,
    });
    assert.deepEqual(outcome, { ok: false, reason: 'network-error' });
  });

  it('surfaces a hostname mismatch from a real payload', async () => {
    const { impl } = fakeFetch({ success: true, action: 'visit', hostname: 'preview.workers.dev', 'error-codes': [] });
    const outcome = await verifyTurnstileToken({
      token: 'tok',
      remoteip: '1.2.3.4',
      expectedAction: 'visit',
      secret: SECRET,
      allowedHostnames: HOSTS,
      fetchImpl: impl,
    });
    assert.deepEqual(outcome, { ok: false, reason: 'hostname-mismatch' });
  });
});
