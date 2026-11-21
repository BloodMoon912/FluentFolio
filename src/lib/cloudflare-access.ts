import { env } from 'cloudflare:workers';
import { isCloudflareAccessApiPath, verifyCloudflareAccessRequest } from './cloudflare-access-core';

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/** The only bypass is Astro's local dev server on a loopback hostname. */
export async function requireCloudflareAccess(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (import.meta.env.DEV && isLoopbackHost(url.hostname)) return null;

  const result = await verifyCloudflareAccessRequest(request, env);
  if (result === 'ok') return null;

  // Route families are decided from the canonicalised pathname: a raw
  // `//api/admin/x` must still produce a JSON error for the API caller.
  const isApi = isCloudflareAccessApiPath(url.pathname);
  const status = result === 'not-configured' ? 503 : 403;
  const message =
    result === 'not-configured'
      ? 'Cloudflare Access is not configured for the admin application.'
      : 'Cloudflare Access verification failed.';

  return isApi
    ? Response.json({ ok: false, error: message }, { status, headers: { 'cache-control': 'no-store' } })
    : new Response(message, {
        status,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
}
