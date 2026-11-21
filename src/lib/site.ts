import { siteConfig } from '../site.config';

// Build-time site metadata shared across the site (mainly the About page).
// These are static values baked at build time (see astro.config.mjs `define`),
// since the Workers runtime has no git and limited process info.

declare global {
  const __SITE_BUILD__: {
    startedAt: string;
    astroVersion: string;
    wranglerVersion: string;
    buildTime: string;
    nodeVersion: string;
    typescriptVersion: string;
  };
}

export const SITE_STARTED_AT = __SITE_BUILD__.startedAt;

export const SITE = {
  domain: new URL(siteConfig.url).host,
  platform: 'Cloudflare Workers',
  startedAt: SITE_STARTED_AT,
  astroVersion: __SITE_BUILD__.astroVersion,
  wranglerVersion: __SITE_BUILD__.wranglerVersion,
  buildTime: __SITE_BUILD__.buildTime,
  nodeVersion: __SITE_BUILD__.nodeVersion,
  typescriptVersion: __SITE_BUILD__.typescriptVersion,
};

export function runtimeSince(startIso: string): { days: number; hours: number; totalHours: number } {
  const diff = Math.max(0, Date.now() - new Date(startIso).getTime());
  const totalHours = Math.floor(diff / 3_600_000);
  return { days: Math.floor(totalHours / 24), hours: totalHours % 24, totalHours };
}
