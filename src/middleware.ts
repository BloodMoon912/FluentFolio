// Security headers for every server-rendered response, plus the Worker-side
// Cloudflare Access gate for every admin page and admin API.
//
// Why headers in middleware and not public/_headers: `_headers` is only applied
// to **static asset** responses. Every page and every API route in this project
// is rendered by the Worker, so the `/admin/*` and `/api/admin/*` rules in
// public/_headers never applied to them — a Worker response is not filtered by
// that file. Static assets (/_astro/*, /background.*, /icons/*, …) still get
// their cache rules from public/_headers.
//
// Only headers that are not already set are filled in, so the two mechanisms
// cannot fight over a value.
//
// #14 adds a `content-security-policy-report-only` header to Worker-rendered
// HTML only (never an enforced full policy). The policy is nonce-free: every
// executable script is a same-origin file under /scripts/, so `script-src
// 'self'` covers both Worker-rendered and prerendered pages. Prerendered pages
// are served by the ASSETS binding before `app.render`, so middleware — and
// therefore this header — never runs for them; that limitation is documented in
// DEPLOY-CLOUDFLARE.md.
//
// Cloudflare Access must also be configured at the edge; the JWT check below
// protects against direct-origin / Worker bypasses. It is mandatory and
// fail-closed: when the verifier or its configuration is unavailable, admin
// requests are answered 503 instead of being served.

import type { MiddlewareHandler } from 'astro';
import { CSP_REPORT_ONLY_HEADER, buildCspReportOnlyPolicy, normalizeOrigin } from './lib/csp-core.ts';

const SECURITY_HEADERS: Record<string, string> = {
  // Never let a browser guess a content type. A stored file returned with the
  // wrong type is how an uploaded image becomes a script.
  'x-content-type-options': 'nosniff',
  // Cross-origin requests get the origin only. Visitor analytics reads the
  // Referer *host*, so it keeps working unchanged.
  'referrer-policy': 'strict-origin-when-cross-origin',
  // The site has no reason to be framed, and /admin least of all. `frame-ancestors`
  // is the modern control; X-Frame-Options is kept for older browsers. The
  // object-src/base-uri additions are safe and stop plugin/base-tag tricks, but
  // this is still NOT a full script/style policy: inline scripts, Swup and the
  // external icon CDN mean a strict script-src needs a Report-Only rollout first.
  'x-frame-options': 'SAMEORIGIN',
  'content-security-policy': "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
  // Nothing here asks for these, so no third-party script can either.
  'permissions-policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=()',
};

/** /admin, /admin/login, /admin/*, /api/admin and /api/admin/*. */
function isAdminPath(pathname: string): boolean {
  return (
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === '/api/admin' ||
    pathname.startsWith('/api/admin/')
  );
}

function isAdminApiPath(pathname: string): boolean {
  return pathname === '/api/admin' || pathname.startsWith('/api/admin/');
}

/**
 * Canonical pathname for the gate.
 *
 * Astro decodes percent-encoding (repeatedly) and collapses duplicate slashes
 * before it routes, and `context.url` is that already-decoded value — so in
 * production middleware classifies exactly the path Astro will route. The same
 * canonicalisation is repeated here so the gate cannot be desynchronised from
 * the router by a future adapter change: `/%61dmin`, `/%2561dmin` and `//admin`
 * are all `/admin`.
 */
function normalizePathname(pathname: string): string {
  let decoded = pathname;
  for (let iteration = 0; iteration < 10; iteration += 1) {
    let next: string;
    try {
      // decodeURI keeps reserved characters (%2F, %3F, %23) encoded, matching
      // Astro; an encoded slash never becomes a path separator.
      next = decodeURI(decoded);
    } catch {
      break;
    }
    if (next === decoded) break;
    decoded = next;
  }
  return decoded.replace(/\/{2,}/g, '/');
}

/**
 * Run the mandatory Cloudflare Access check.
 *
 * The verifier is imported lazily on purpose: it imports `cloudflare:workers`
 * and extensionless module specifiers that only resolve inside Astro/Vite, so a
 * static import makes this file (and `tests/middleware.test.ts`) fail at import
 * time under plain Node. A *failure to load* the verifier must never skip the
 * gate, so every error falls back to the same fail-closed 503 a missing Access
 * configuration produces.
 */
async function verifyAccess(request: Request, adminApi: boolean): Promise<Response | null> {
  try {
    const { requireCloudflareAccess } = await import('./lib/cloudflare-access');
    return await requireCloudflareAccess(request);
  } catch {
    const message = 'Cloudflare Access verification is unavailable for the admin application.';
    return adminApi
      ? Response.json({ ok: false, error: message }, { status: 503, headers: { 'cache-control': 'no-store, private' } })
      : new Response(message, {
          status: 503,
          headers: {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store, private',
          },
        });
  }
}

function applyHeaders(headers: Headers, pathname: string, cspReportOnly: string | null): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }

  // Report-Only only, and only when the route has not set a policy already: the
  // full policy must be observed before anyone considers enforcing it.
  if (cspReportOnly && !headers.has(CSP_REPORT_ONLY_HEADER)) {
    headers.set(CSP_REPORT_ONLY_HEADER, cspReportOnly);
  }

  // /admin carries a noindex <meta> tag from AdminLayout, but an API response
  // has no <head>; state the intent for both here.
  if (isAdminPath(pathname)) {
    if (!headers.has('x-robots-tag')) headers.set('x-robots-tag', 'noindex, nofollow');
    // public/_headers only covers static assets, so the SSR admin pages and
    // APIs need this here. Always override: even a route that forgot no-store
    // must not let an authenticated/error response be cached by a proxy.
    headers.set('cache-control', 'no-store, private');
  }
}

/** Only HTML documents can be governed by a document CSP. */
function isHtmlResponse(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').toLowerCase().includes('text/html');
}

let cachedR2ImageOrigin: string | null | undefined;

/**
 * The R2 public image origin for `img-src`, read from the Worker's plain var.
 * The dynamic import keeps this module loadable under plain `node --test`;
 * outside the Workers runtime it simply resolves to null.
 */
async function r2ImageOrigin(): Promise<string | null> {
  if (cachedR2ImageOrigin !== undefined) return cachedR2ImageOrigin;
  cachedR2ImageOrigin = null;
  try {
    const { env } = await import('cloudflare:workers');
    cachedR2ImageOrigin = normalizeOrigin(env.R2_PUBLIC_BASE_URL);
  } catch {
    // Plain Node (unit tests) has no `cloudflare:workers` module.
  }
  return cachedR2ImageOrigin;
}

export const onRequest: MiddlewareHandler = async (context, next) => {
  const pathname = normalizePathname(context.url.pathname);

  // No nonce: the policy is nonce-free, so nothing has to be generated before
  // the route renders.
  const accessFailure = isAdminPath(pathname) ? await verifyAccess(context.request, isAdminApiPath(pathname)) : null;
  const response = accessFailure ?? (await next());

  let cspReportOnly: string | null = null;
  if (!accessFailure && isHtmlResponse(response)) {
    const r2Origin = await r2ImageOrigin();
    cspReportOnly = buildCspReportOnlyPolicy({ imageOrigins: r2Origin ? [r2Origin] : [] });
  }

  try {
    // The common path: the SSR response's headers are mutable.
    applyHeaders(response.headers, pathname, cspReportOnly);
    return response;
  } catch {
    // Redirects created by Response.redirect() have immutable headers, and
    // Astro.redirect() (used by /admin when unauthenticated) produces one.
    // Re-wrap rather than letting a redirect turn into a 500.
    const headers = new Headers(response.headers);
    applyHeaders(headers, pathname, cspReportOnly);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
};
