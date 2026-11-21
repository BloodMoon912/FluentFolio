// Site identity. This is the one file to edit first: names, handle, tagline,
// social links and optional donation buttons all come from here. Longer UI copy
// (the Privacy Policy, Terms of Use, page titles) lives in src/i18n/ui.ts.
export const profile = {
  name: 'Your Name',
  nameZh: '你的名字',
  nameEn: 'Your Name',
  // Short name used as the title suffix ("Posts · FluentFolio") and in JSON-LD.
  nameShort: 'FluentFolio',
  handle: '@yourname',
  tagline: 'Developer · Writer · Gamer',
  bio: '記錄開發、創作與正在進行的實驗。',
};

// Service rows for the homepage panel and /status. Every key here must have a
// real probe in src/pages/api/status.ts — a hardcoded `ok: true` row would lie
// to visitors. Remove a row here only together with its probe.
export const services = [
  { key: 'website', id: 'service_website', descId: 'service_website_desc' },
  { key: 'database', id: 'service_database', descId: 'service_database_desc' },
  { key: 'activity', id: 'service_activity', descId: 'service_activity_desc' },
  { key: 'steam', id: 'service_steam', descId: 'service_steam_desc' },
] as const;

// Social icons shown in the site footer. The `icon` key must exist in the SVG
// set in BaseLayout.astro: github, youtube, discord, steam, x, mail.
// Replace the placeholder URLs with your own profiles, or delete the rows you
// do not use. The Discord row is only a link; the homepage presence panel reads
// the account named by the DISCORD_USER_ID secret (see README).
export const socials = [
  { name: 'GitHub', icon: 'github', url: 'https://github.com/your-name' },
  { name: 'Discord', icon: 'discord', url: 'https://discord.com/users/000000000000000000' },
  { name: 'Steam', icon: 'steam', url: 'https://steamcommunity.com/id/yourname' },
];

export interface SupportLink {
  /** CSS hook: the button gets the class `support-<id>`. */
  id: string;
  name: string;
  url: string;
  /** Badge image. The host must be allowed in `img-src` (src/lib/csp-core.ts). */
  image: string;
  width: number;
  height: number;
  alt?: string;
}

// Optional donation buttons shown above the licence line. Empty by default, so
// nothing is rendered. Ko-fi and Liberapay badge hosts are already allowed by
// the Content-Security-Policy; for any other host add it to csp-core.ts first.
// Example:
//   { id: 'kofi', name: 'Ko-fi', url: 'https://ko-fi.com/yourname',
//     image: 'https://storage.ko-fi.com/cdn/kofi5.png?v=3', width: 111, height: 28 },
export const supportLinks: SupportLink[] = [];

// "Setup" rows on the About page. `key` is an i18n label from src/i18n/ui.ts
// (setup_cpu, setup_gpu, setup_memory, setup_storage, setup_display,
// setup_peripherals); `value` is your own hardware. Delete rows you do not want.
export const aboutSetup = [
  { key: 'setup_cpu', value: 'Your CPU' },
  { key: 'setup_gpu', value: 'Your GPU' },
  { key: 'setup_memory', value: 'Your memory' },
  { key: 'setup_storage', value: 'Your storage' },
  { key: 'setup_display', value: 'Your display' },
  { key: 'setup_peripherals', value: 'Your keyboard · mouse · headset' },
];

// Games shown as links on the About page. Plain names and URLs, no i18n keys.
export const aboutGames = [{ name: 'Minecraft', url: 'https://minecraft.wiki/' }];
