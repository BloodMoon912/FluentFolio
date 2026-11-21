import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCloudflareAccessAudience,
  normalizeAdminPathname,
  resetAccessKeyCacheForTests,
  verifyCloudflareAccessJwt,
  verifyCloudflareAccessRequest,
} from '../src/lib/cloudflare-access-core.ts';

const issuer = 'https://example-team.cloudflareaccess.com';
const audience = 'test-application-audience';
const TOKEN_NOW = 1_800_000_000;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function jsonSegment(value: unknown): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function createSignedToken(overrides: Record<string, unknown> = {}) {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const kid = 'test-key-id';
  const jwkSet = { keys: [{ ...publicJwk, kid, alg: 'RS256', use: 'sig' }] };
  const now = 1_800_000_000;
  const header = jsonSegment({ alg: 'RS256', typ: 'JWT', kid });
  const payload = jsonSegment({ iss: issuer, aud: [audience], iat: now, nbf: now - 10, exp: now + 300, ...overrides });
  const unsigned = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    keyPair.privateKey,
    new TextEncoder().encode(unsigned),
  );
  const token = `${unsigned}.${toBase64Url(new Uint8Array(signature))}`;
  const fetcher: typeof fetch = async () =>
    new Response(JSON.stringify(jwkSet), { headers: { 'content-type': 'application/json' } });
  return { token, fetcher, now };
}

test('accepts a valid Cloudflare Access RS256 JWT with matching issuer and AUD', async () => {
  resetAccessKeyCacheForTests();
  const { token, fetcher, now } = await createSignedToken();
  assert.equal(
    await verifyCloudflareAccessJwt(token, { teamDomain: issuer, audience, nowSeconds: now, fetcher }),
    true,
  );
});

test('rejects an Access JWT with a different application audience', async () => {
  resetAccessKeyCacheForTests();
  const { token, fetcher, now } = await createSignedToken({ aud: ['not-this-app'] });
  assert.equal(
    await verifyCloudflareAccessJwt(token, { teamDomain: issuer, audience, nowSeconds: now, fetcher }),
    false,
  );
});

test('rejects an expired token and a wrong issuer', async () => {
  resetAccessKeyCacheForTests();
  const expired = await createSignedToken({ exp: 1_799_999_000 });
  assert.equal(
    await verifyCloudflareAccessJwt(expired.token, {
      teamDomain: issuer,
      audience,
      nowSeconds: expired.now,
      fetcher: expired.fetcher,
    }),
    false,
  );

  resetAccessKeyCacheForTests();
  const wrongIssuer = await createSignedToken({ iss: 'https://attacker.example' });
  assert.equal(
    await verifyCloudflareAccessJwt(wrongIssuer.token, {
      teamDomain: issuer,
      audience,
      nowSeconds: wrongIssuer.now,
      fetcher: wrongIssuer.fetcher,
    }),
    false,
  );
});

test('rejects a modified signature and missing verification configuration', async () => {
  resetAccessKeyCacheForTests();
  const { token, fetcher, now } = await createSignedToken();
  const [header, payload, signature] = token.split('.');
  const changedSignature = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
  const modified = `${header}.${payload}.${changedSignature}`;
  assert.equal(
    await verifyCloudflareAccessJwt(modified, { teamDomain: issuer, audience, nowSeconds: now, fetcher }),
    false,
  );
  assert.equal(
    await verifyCloudflareAccessJwt(token, { teamDomain: issuer, audience: '', nowSeconds: now, fetcher }),
    false,
  );
});

test('request verifier fails closed without an Access assertion header', async () => {
  const request = new Request('https://www.example.com/admin/login');
  assert.equal(
    await verifyCloudflareAccessRequest(request, { ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: audience }),
    'missing-token',
  );
  assert.equal(
    await verifyCloudflareAccessRequest(request, { ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: audience }),
    'not-configured',
  );
});

test('selects a dedicated audience for admin pages and API routes', () => {
  const environment = {
    ACCESS_TEAM_DOMAIN: issuer,
    ACCESS_ADMIN_AUD: 'admin-pages-audience',
    ACCESS_API_AUD: 'admin-api-audience',
  };
  assert.equal(
    getCloudflareAccessAudience(new Request('https://www.example.com/admin/login'), environment),
    'admin-pages-audience',
  );
  assert.equal(
    getCloudflareAccessAudience(new Request('https://www.example.com/api/admin/login'), environment),
    'admin-api-audience',
  );
});

test('supports one shared audience but rejects a global comma-separated audience list', () => {
  const shared = { ACCESS_AUD: audience };
  assert.equal(getCloudflareAccessAudience(new Request('https://www.example.com/admin'), shared), audience);
  assert.equal(getCloudflareAccessAudience(new Request('https://www.example.com/api/admin/posts'), shared), audience);

  const unsafeGlobalList = { ACCESS_AUD: 'admin-pages-audience,admin-api-audience' };
  assert.equal(getCloudflareAccessAudience(new Request('https://www.example.com/admin'), unsafeGlobalList), null);
  assert.equal(
    getCloudflareAccessAudience(new Request('https://www.example.com/api/admin/posts'), unsafeGlobalList),
    null,
  );
});

test('fails closed when only one route-specific audience is configured', () => {
  const partial = { ACCESS_AUD: 'legacy-shared-audience', ACCESS_ADMIN_AUD: 'admin-pages-audience' };
  assert.equal(
    getCloudflareAccessAudience(new Request('https://www.example.com/admin'), partial),
    'admin-pages-audience',
  );
  assert.equal(getCloudflareAccessAudience(new Request('https://www.example.com/api/admin/posts'), partial), null);
});

test('rejects a valid page-application JWT when reused against the admin API application', async () => {
  resetAccessKeyCacheForTests();
  const pageAud = 'admin-pages-audience';
  const apiAud = 'admin-api-audience';
  const now = Math.floor(Date.now() / 1000);
  const { token, fetcher } = await createSignedToken({ aud: [pageAud], iat: now, nbf: now - 10, exp: now + 300 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetcher;
  try {
    const environment = {
      ACCESS_TEAM_DOMAIN: issuer,
      ACCESS_ADMIN_AUD: pageAud,
      ACCESS_API_AUD: apiAud,
    };
    const pageRequest = new Request('https://www.example.com/admin/login', {
      headers: { 'cf-access-jwt-assertion': token },
    });
    assert.equal(
      await verifyCloudflareAccessJwt(token, { teamDomain: issuer, audience: pageAud, nowSeconds: now, fetcher }),
      true,
    );
    assert.equal(await verifyCloudflareAccessRequest(pageRequest, environment), 'ok');
    // The same page-application token must not reach the API application, even
    // when the path is percent-encoded or has duplicate slashes: the audience is
    // chosen from the canonicalised pathname, matching what Astro will route.
    for (const path of ['/api/admin/posts', '/api/%61dmin/posts', '//api/admin/posts']) {
      const apiRequest = new Request(`https://www.example.com${path}`, {
        headers: { 'cf-access-jwt-assertion': token },
      });
      assert.equal(await verifyCloudflareAccessRequest(apiRequest, environment), 'invalid-token', path);
    }
  } finally {
    globalThis.fetch = originalFetch;
    resetAccessKeyCacheForTests();
  }
});

// --- helpers for the key-rotation and throttle tests ------------------------

async function generateRsaKeyPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
}

async function verificationJwk(keyPair: CryptoKeyPair, kid: string) {
  const publicJwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as JsonWebKey;
  return { ...publicJwk, kid, alg: 'RS256', use: 'sig' };
}

function validPayload(now: number): Record<string, unknown> {
  return { iss: issuer, aud: [audience], iat: now, nbf: now - 10, exp: now + 300 };
}

async function signToken(keyPair: CryptoKeyPair, kid: string, payload: Record<string, unknown>): Promise<string> {
  const header = jsonSegment({ alg: 'RS256', typ: 'JWT', kid });
  const body = jsonSegment(payload);
  const unsigned = `${header}.${body}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    keyPair.privateKey,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${toBase64Url(new Uint8Array(signature))}`;
}

function jwksFetcher(keys: unknown[], onFetch?: () => void): typeof fetch {
  return (async () => {
    onFetch?.();
    return new Response(JSON.stringify({ keys }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

// --- path canonicalisation --------------------------------------------------

test('canonicalises the pathname before the audience decision', () => {
  assert.equal(normalizeAdminPathname('/admin'), '/admin');
  assert.equal(normalizeAdminPathname('//admin'), '/admin');
  assert.equal(normalizeAdminPathname('/%61dmin/login'), '/admin/login');
  assert.equal(normalizeAdminPathname('/%2561dmin'), '/admin');
  assert.equal(normalizeAdminPathname('/%2e/api/admin'), '/api/admin');
  assert.equal(normalizeAdminPathname('/foo/../admin'), '/admin');
  assert.equal(normalizeAdminPathname('/api/admin%2Fposts'), '/api/admin%2Fposts');
  assert.equal(normalizeAdminPathname('/ADMIN'), '/ADMIN');
  assert.equal(normalizeAdminPathname('/admin.'), '/admin.');
});

test('selects the API audience for encoded and slash-normalised API paths', () => {
  const environment = {
    ACCESS_TEAM_DOMAIN: issuer,
    ACCESS_ADMIN_AUD: 'admin-pages-audience',
    ACCESS_API_AUD: 'admin-api-audience',
  };
  for (const path of ['/admin', '/admin/login', '/%61dmin', '/%2561dmin', '//admin']) {
    assert.equal(
      getCloudflareAccessAudience(new Request(`https://www.example.com${path}`), environment),
      'admin-pages-audience',
      path,
    );
  }
  for (const path of ['/api/admin', '/api/admin/posts', '/api/%61dmin/posts', '//api/admin/posts']) {
    assert.equal(
      getCloudflareAccessAudience(new Request(`https://www.example.com${path}`), environment),
      'admin-api-audience',
      path,
    );
  }
});

// --- key rotation and JWKS fetch throttling ---------------------------------

test('refetches the signing keys when Access rotates to a new key id', async () => {
  resetAccessKeyCacheForTests();
  const oldKey = await generateRsaKeyPair();
  const newKey = await generateRsaKeyPair();
  const oldJwk = await verificationJwk(oldKey, 'key-1');
  const newJwk = await verificationJwk(newKey, 'key-2');
  let fetches = 0;
  const rotatingFetcher: typeof fetch = async () => {
    fetches += 1;
    const body = { keys: fetches === 1 ? [oldJwk] : [oldJwk, newJwk] };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };

  const oldToken = await signToken(oldKey, 'key-1', validPayload(TOKEN_NOW));
  assert.equal(
    await verifyCloudflareAccessJwt(oldToken, {
      teamDomain: issuer,
      audience,
      nowSeconds: TOKEN_NOW,
      fetcher: rotatingFetcher,
    }),
    true,
  );
  assert.equal(fetches, 1);

  const newToken = await signToken(newKey, 'key-2', validPayload(TOKEN_NOW));
  assert.equal(
    await verifyCloudflareAccessJwt(newToken, {
      teamDomain: issuer,
      audience,
      nowSeconds: TOKEN_NOW,
      fetcher: rotatingFetcher,
    }),
    true,
  );
  assert.equal(fetches, 2);
  resetAccessKeyCacheForTests();
});

test('does not fetch the JWKS once per request for unknown key ids', async () => {
  resetAccessKeyCacheForTests();
  const keyPair = await generateRsaKeyPair();
  const jwk = await verificationJwk(keyPair, 'known-key');
  let fetches = 0;
  const fetcher = jwksFetcher([jwk], () => {
    fetches += 1;
  });

  const valid = await signToken(keyPair, 'known-key', validPayload(TOKEN_NOW));
  assert.equal(
    await verifyCloudflareAccessJwt(valid, { teamDomain: issuer, audience, nowSeconds: TOKEN_NOW, fetcher }),
    true,
  );
  assert.equal(fetches, 1);

  const unknownOne = await signToken(keyPair, 'unknown-key-1', validPayload(TOKEN_NOW));
  assert.equal(
    await verifyCloudflareAccessJwt(unknownOne, { teamDomain: issuer, audience, nowSeconds: TOKEN_NOW, fetcher }),
    false,
  );
  assert.equal(fetches, 2);

  // Within the forced-refresh cooldown the cached key set is reused, so a cheap
  // unauthenticated request cannot be amplified into one outbound fetch each.
  const unknownTwo = await signToken(keyPair, 'unknown-key-2', validPayload(TOKEN_NOW));
  assert.equal(
    await verifyCloudflareAccessJwt(unknownTwo, { teamDomain: issuer, audience, nowSeconds: TOKEN_NOW, fetcher }),
    false,
  );
  assert.equal(fetches, 2);
  resetAccessKeyCacheForTests();
});

// --- time claims ------------------------------------------------------------

test('rejects a token whose nbf or iat is in the future', async () => {
  resetAccessKeyCacheForTests();
  const notYetValid = await createSignedToken({ nbf: TOKEN_NOW + 120, iat: TOKEN_NOW });
  assert.equal(
    await verifyCloudflareAccessJwt(notYetValid.token, {
      teamDomain: issuer,
      audience,
      nowSeconds: notYetValid.now,
      fetcher: notYetValid.fetcher,
    }),
    false,
  );

  resetAccessKeyCacheForTests();
  const issuedInFuture = await createSignedToken({ iat: TOKEN_NOW + 120 });
  assert.equal(
    await verifyCloudflareAccessJwt(issuedInFuture.token, {
      teamDomain: issuer,
      audience,
      nowSeconds: issuedInFuture.now,
      fetcher: issuedInFuture.fetcher,
    }),
    false,
  );
});

test('rejects a token with no iat claim but still accepts one without nbf', async () => {
  resetAccessKeyCacheForTests();
  const missingIat = await createSignedToken({ iat: undefined });
  assert.equal(
    await verifyCloudflareAccessJwt(missingIat.token, {
      teamDomain: issuer,
      audience,
      nowSeconds: missingIat.now,
      fetcher: missingIat.fetcher,
    }),
    false,
  );

  // Access service-token JWTs do not always carry `nbf`; its absence is not a
  // failure, but a present-and-future value is (covered above).
  resetAccessKeyCacheForTests();
  const missingNbf = await createSignedToken({ nbf: undefined });
  assert.equal(
    await verifyCloudflareAccessJwt(missingNbf.token, {
      teamDomain: issuer,
      audience,
      nowSeconds: missingNbf.now,
      fetcher: missingNbf.fetcher,
    }),
    true,
  );
});

test('rejects a token signed with a non-RS256 algorithm', async () => {
  resetAccessKeyCacheForTests();
  const { token, fetcher, now } = await createSignedToken();
  // Flip the header to a well-known "none" algorithm; the signature no longer
  // matters because the algorithm allow-list must reject it first.
  const [, payload, signature] = token.split('.');
  const noneHeader = jsonSegment({ alg: 'none', typ: 'JWT', kid: 'test-key-id' });
  assert.equal(
    await verifyCloudflareAccessJwt(`${noneHeader}.${payload}.${signature}`, {
      teamDomain: issuer,
      audience,
      nowSeconds: now,
      fetcher,
    }),
    false,
  );
});
