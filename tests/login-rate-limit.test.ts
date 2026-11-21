import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ADMIN_LOGIN_RETRY_AFTER_SECONDS,
  decideAdminLogin,
  type AdminLoginRateLimiter,
} from '../src/lib/admin-login-core.ts';

const RATE_LIMIT_KEY = 'admin-login:203.0.113.7';

function limiterReturning(success: boolean, calls: string[] = []): AdminLoginRateLimiter {
  return {
    async limit({ key }) {
      calls.push(key);
      return { success };
    },
  };
}

describe('decideAdminLogin (#3)', () => {
  it('answers 429 for an exhausted bucket even when the password is correct, without comparing it', async () => {
    const order: string[] = [];
    const decision = await decideAdminLogin({
      password: 'the-correct-password',
      rateLimitKey: RATE_LIMIT_KEY,
      limiter: {
        async limit() {
          order.push('limit');
          return { success: false };
        },
      },
      checkPassword() {
        order.push('password');
        return true;
      },
    });

    assert.deepEqual(decision, { kind: 'rate-limited', retryAfterSeconds: ADMIN_LOGIN_RETRY_AFTER_SECONDS });
    assert.deepEqual(order, ['limit'], 'the password must not be compared once the bucket is exhausted');
  });

  it('also answers 429 for an exhausted bucket when the password is wrong', async () => {
    const decision = await decideAdminLogin({
      password: 'wrong',
      rateLimitKey: RATE_LIMIT_KEY,
      limiter: limiterReturning(false),
      checkPassword: () => false,
    });
    assert.equal(decision.kind, 'rate-limited');
  });

  it('consults the limiter before the password and uses the caller-provided key', async () => {
    const order: string[] = [];
    const keys: string[] = [];
    const decision = await decideAdminLogin({
      password: 'correct',
      rateLimitKey: RATE_LIMIT_KEY,
      limiter: {
        async limit({ key }) {
          order.push('limit');
          keys.push(key);
          return { success: true };
        },
      },
      checkPassword() {
        order.push('password');
        return true;
      },
    });

    assert.deepEqual(decision, { kind: 'ok' });
    assert.deepEqual(order, ['limit', 'password']);
    assert.deepEqual(keys, [RATE_LIMIT_KEY]);
  });

  it('leaves a request under the limit unchanged (correct -> ok, wrong -> invalid)', async () => {
    for (const [password, expected] of [
      ['correct', 'ok'],
      ['wrong', 'invalid-password'],
    ] as const) {
      const decision = await decideAdminLogin({
        password,
        rateLimitKey: RATE_LIMIT_KEY,
        limiter: limiterReturning(true),
        checkPassword: (candidate) => candidate === 'correct',
      });
      assert.equal(decision.kind, expected);
    }
  });

  it('leaves requests unchanged when the limiter binding is absent', async () => {
    for (const [password, expected] of [
      ['correct', 'ok'],
      ['wrong', 'invalid-password'],
    ] as const) {
      const decision = await decideAdminLogin({
        password,
        rateLimitKey: RATE_LIMIT_KEY,
        limiter: null,
        checkPassword: (candidate) => candidate === 'correct',
      });
      assert.equal(decision.kind, expected);
    }
  });

  it('treats a limiter binding error as best-effort and still compares the password', async () => {
    let compared = 0;
    const decision = await decideAdminLogin({
      password: 'correct',
      rateLimitKey: RATE_LIMIT_KEY,
      limiter: {
        async limit() {
          throw new Error('rate limiter binding unavailable');
        },
      },
      checkPassword() {
        compared += 1;
        return true;
      },
    });
    assert.equal(decision.kind, 'ok');
    assert.equal(compared, 1);
  });

  it('uses a 60-second Retry-After value', () => {
    assert.equal(ADMIN_LOGIN_RETRY_AFTER_SECONDS, 60);
  });
});
