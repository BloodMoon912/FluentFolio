import type { APIRoute } from 'astro';
import { siteConfig } from '../site.config';

// The web app manifest is generated from site.config.json so the theme never
// carries a site's name or icon paths in a static public file.
export const prerender = true;

export const GET: APIRoute = () => {
  const manifest = {
    name: siteConfig.profile.nameZh,
    short_name: siteConfig.titleSuffix,
    description: siteConfig.profile.bio,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0d0f13',
    theme_color: '#0d0f13',
    lang: 'zh-Hant',
    icons: [
      { src: '/brand/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/brand/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
  });
};
