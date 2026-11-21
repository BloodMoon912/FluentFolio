import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { HONG_KONG_TIME_ZONE } from '../../lib/time';

export const GET: APIRoute = async () => {
  let database = 'not-configured';
  if (env.DB) {
    try {
      await env.DB.prepare('SELECT 1 AS ok').first();
      database = 'ok';
    } catch {
      database = 'error';
    }
  }
  const status = database === 'error' ? 'degraded' : 'ok';
  return Response.json(
    {
      status,
      service: 'personal-site',
      database,
      time: new Date().toISOString(),
      timeZone: HONG_KONG_TIME_ZONE,
      timeSource: 'Cloudflare runtime clock',
    },
    { status: status === 'ok' ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
};
