import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { onRequest } from '../src/middleware.ts';
import { DEFAULT_IMAGE_ORIGINS, buildCspReportOnlyPolicy, normalizeOrigin } from '../src/lib/csp-core.ts';

type MiddlewareArgs = Parameters<typeof onRequest>;

interface RunResult {
  response: Response;
  nextCalled: boolean;
}

/**
 * `MiddlewareHandler` is allowed to return void, so the result has to be
 * narrowed before it can be asserted on. `nextCalled` records whether the
 * request was allowed to reach the route at all.
 */
async function runWithNext(
  pathname: string,
  makeResponse: () => Response = () => new Response('ok'),
): Promise<RunResult> {
  const context = {
    url: new URL(`https://www.example.com${pathname}`),
    locals: {},
  } as unknown as MiddlewareArgs[0];
  let nextCalled = false;
  const next = (async () => {
    nextCalled = true;
    return makeResponse();
  }) as unknown as MiddlewareArgs[1];
  const result = await onRequest(context, next);
  assert.ok(result instanceof Response, 'the middleware must return a Response');
  return { response: result, nextCalled };
}

async function run(pathname: string, makeResponse?: () => Response): Promise<Response> {
  return (await runWithNext(pathname, makeResponse)).response;
}

describe('security headers middleware', () => {
  it('adds the security header set to an SSR response', async () => {
    const response = await run('/', () => new Response('ok'));

    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(
      response.headers.get('content-security-policy'),
      "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
    );
    assert.match(response.headers.get('permissions-policy') ?? '', /geolocation=\(\)/);
  });

  it('never overwrites a header the route already set', async () => {
    const response = await run('/', () => new Response('ok', { headers: { 'referrer-policy': 'no-referrer' } }));
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  });

  it('preserves the status and body of a normal response', async () => {
    const response = await run('/blog', () => new Response('body', { status: 201 }));
    assert.equal(response.status, 201);
    assert.equal(await response.text(), 'body');
  });

  it('does not add no-store to public responses', async () => {
    const response = await run('/posts', () => new Response('ok'));
    assert.equal(response.headers.get('cache-control'), null);
  });

  it('leaves public routes indexable, including names that only start with "admin"', async () => {
    for (const path of ['/blog', '/administrator', '/admin-ish']) {
      const { response, nextCalled } = await runWithNext(path);
      assert.equal(nextCalled, true, path);
      assert.equal(response.headers.get('x-robots-tag'), null, path);
      assert.equal(response.headers.get('cache-control'), null, path);
    }
  });

  it('survives a response with immutable headers (Astro.redirect)', async () => {
    // Response.redirect() produces headers that cannot be mutated in place, and
    // a public route such as /posts may redirect like this. Throwing here would
    // turn a 302 into a 500.
    const redirect = Response.redirect('https://www.example.com/posts?tab=blog', 302);
    assert.equal(redirect.headers.get('location'), 'https://www.example.com/posts?tab=blog');

    const response = await run('/posts', () => redirect);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'https://www.example.com/posts?tab=blog');
    assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
  });
});

describe('Cloudflare Access gate', () => {
  const adminPages = ['/admin', '/admin/login', '/admin/posts', '/%61dmin', '/%2561dmin', '//admin'];

  it('fails closed for every admin page', async () => {
    for (const path of adminPages) {
      const { response, nextCalled } = await runWithNext(path, () => new Response('leaked admin page'));
      assert.equal(nextCalled, false, `${path} must not reach the route`);
      assert.equal(response.status, 503, path);
      assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8', path);
      assert.match(await response.text(), /Cloudflare Access/, path);
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow', path);
      // Fail-closed responses must never be cached by a proxy or the browser.
      assert.equal(response.headers.get('cache-control'), 'no-store, private', path);
    }
  });

  const adminApiPaths = [
    '/api/admin',
    '/api/admin/posts',
    '/api/admin/passkey/login-options',
    '/api/%61dmin/posts',
    '//api/admin/posts',
  ];

  it('fails closed with a JSON body for every admin API route', async () => {
    for (const path of adminApiPaths) {
      const { response, nextCalled } = await runWithNext(path, () => new Response('leaked admin api'));
      assert.equal(nextCalled, false, `${path} must not reach the route`);
      assert.equal(response.status, 503, path);
      assert.match(response.headers.get('content-type') ?? '', /^application\/json/, path);
      const body = (await response.json()) as { ok: boolean; error: string };
      assert.equal(body.ok, false, path);
      assert.match(body.error, /Cloudflare Access/, path);
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow', path);
      assert.equal(response.headers.get('cache-control'), 'no-store, private', path);
    }
  });

  it('does not gate the public site', async () => {
    for (const path of ['/', '/posts', '/api/visitors', '/api/activity']) {
      const { response, nextCalled } = await runWithNext(path);
      assert.equal(nextCalled, true, path);
      assert.equal(response.headers.get('cache-control'), null, path);
    }
  });
});

const CSP_BASELINE = "frame-ancestors 'self'; object-src 'none'; base-uri 'self'";

function htmlResponse(body = '<!doctype html><html><head></head><body>ok</body></html>'): Response {
  return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

describe('CSP Report-Only (#14)', () => {
  it('adds one nonce-free Report-Only policy to Worker-rendered HTML', async () => {
    const { response } = await runWithNext('/posts', htmlResponse);
    const policy = response.headers.get('content-security-policy-report-only');
    assert.ok(policy, 'an HTML response must carry the Report-Only policy');

    for (const expected of [
      "default-src 'self'",
      "script-src 'self' https://challenges.cloudflare.com",
      "connect-src 'self' https://api.lanyard.rest wss://api.lanyard.rest",
      'frame-src https://challenges.cloudflare.com',
      'img-src',
      'https://cdn.discordapp.com',
      'https://avatars.steamstatic.com',
      'https://storage.ko-fi.com',
      'https://liberapay.com',
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
    ]) {
      assert.ok(policy.includes(expected), `policy should contain ${expected}`);
    }

    assert.equal(policy.includes("'nonce-"), false, 'the policy must not ask for a nonce');
    assert.equal(policy.includes("'unsafe-eval'"), false);
  });

  it('keeps the enforced header untouched and never turns the policy into an enforced one', async () => {
    const { response } = await runWithNext('/', htmlResponse);
    assert.equal(response.headers.get('content-security-policy'), CSP_BASELINE);
    assert.notEqual(response.headers.get('content-security-policy-report-only'), null);
  });

  it('emits the same nonce-free policy on every request', async () => {
    const first = await runWithNext('/', htmlResponse);
    const second = await runWithNext('/', htmlResponse);
    assert.equal(
      first.response.headers.get('content-security-policy-report-only'),
      second.response.headers.get('content-security-policy-report-only'),
    );
    assert.equal(String(first.response.headers.get('content-security-policy-report-only')).includes("'nonce-"), false);
  });

  it('does not add the policy to non-HTML responses', async () => {
    const { response } = await runWithNext('/api/visitors', () => Response.json({ ok: true }));
    assert.equal(response.headers.get('content-security-policy-report-only'), null);
    assert.equal(response.headers.get('content-security-policy'), CSP_BASELINE);
  });

  it('does not add the policy to fail-closed Access responses', async () => {
    const { response } = await runWithNext('/admin', () => new Response('leaked admin page'));
    assert.equal(response.headers.get('content-security-policy-report-only'), null);
    assert.equal(response.headers.get('content-security-policy'), CSP_BASELINE);
  });

  it('never overwrites a Report-Only policy a route already set', async () => {
    const { response } = await runWithNext('/', () => {
      const routeResponse = htmlResponse();
      routeResponse.headers.set('content-security-policy-report-only', "default-src 'none'");
      return routeResponse;
    });
    assert.equal(response.headers.get('content-security-policy-report-only'), "default-src 'none'");
  });
});

describe('CSP policy helpers', () => {
  it('normalizeOrigin keeps https origins only', () => {
    assert.equal(normalizeOrigin('https://img.example.com/uploads/'), 'https://img.example.com');
    assert.equal(normalizeOrigin('http://img.example.com'), null);
    assert.equal(normalizeOrigin('not a url'), null);
    assert.equal(normalizeOrigin(''), null);
    assert.equal(normalizeOrigin(null), null);
    assert.equal(normalizeOrigin(undefined), null);
  });

  it('buildCspReportOnlyPolicy merges, dedupes and sorts extra image origins', () => {
    const policy = buildCspReportOnlyPolicy({
      imageOrigins: ['https://img.example.com', 'https://avatars.steamstatic.com'],
    });

    assert.ok(policy.includes("script-src 'self' https://challenges.cloudflare.com"));
    assert.equal(policy.includes("'nonce-"), false);
    assert.equal(policy.split('https://avatars.steamstatic.com').length - 1, 1);
    assert.ok(policy.includes('https://img.example.com'));
    for (const origin of DEFAULT_IMAGE_ORIGINS) assert.ok(policy.includes(origin), origin);
    // The R2 origin is appended after the defaults, so the img-src list is sorted.
    const imgSrc = policy.split('; ').find((directive) => directive.startsWith('img-src ')) ?? '';
    const origins = imgSrc.split(' ').filter((token) => token.startsWith('https://'));
    assert.deepEqual(origins, [...origins].sort());
  });
});
