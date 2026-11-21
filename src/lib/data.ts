// Compatibility shim: site data now lives in site.config.json.
//
// Import from '../site.config.ts' in new code. This module stays so existing
// imports keep working and so the JSON remains the single source of truth.
export { profile, services, socials, supportLinks, aboutSetup, aboutGames } from '../site.config.ts';
export type { SupportLink } from '../site.config.ts';
