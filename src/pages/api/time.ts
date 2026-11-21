import type { APIRoute } from 'astro';
import { HONG_KONG_UTC_OFFSET, HONG_KONG_TIME_ZONE } from '../../lib/time';

export const GET: APIRoute = () => {
  const now = new Date();
  return Response.json(
    {
      now: now.toISOString(),
      epochMs: now.getTime(),
      timeZone: HONG_KONG_TIME_ZONE,
      utcOffset: HONG_KONG_UTC_OFFSET,
      label: 'Hong Kong Standard Time',
      source: 'Cloudflare runtime clock',
      sourceUrl: null,
      note: 'Runtime timestamps are UTC instants rendered as Hong Kong Standard Time (UTC+08:00).',
    },
    { headers: { 'cache-control': 'no-store' } },
  );
};
