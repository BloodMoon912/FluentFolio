import type { APIRoute } from 'astro';
import { defaultOgCard, renderOgPng } from '../lib/og-png';

// Prerendered at build time (Node, see `prerenderEnvironment` in
// astro.config.mjs) and served as a plain static file, so social crawlers get a
// real PNG. `/og.svg` stays for links that already point at it.
export const prerender = true;

export const GET: APIRoute = () => {
  const png = renderOgPng(defaultOgCard());
  return new Response(png, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
