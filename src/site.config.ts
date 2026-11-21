// Site identity that a derived site is expected to change.
//
// Everything here is consumed by `src/layouts/BaseLayout.astro`; no layout file
// needs to be edited to rename the site or reorder the navigation. When this
// theme is updated, `src/layouts/BaseLayout.astro` can be replaced wholesale and
// only this file (plus `src/lib/data.ts`, `src/i18n/ui.ts`, `src/content/` and
// `public/`) carries site-specific values.
//
// Keep it dependency-light: it is imported by the layout at build time and must
// not touch the DOM or read environment variables.

import { profile } from './lib/data';

export interface NavItem {
  href: string;
  /** i18n key in src/i18n/ui.ts, e.g. `brand_posts`. */
  key: string;
  /** `true` for pages that should only be active on their exact path. */
  exact: boolean;
}

export interface SiteConfig {
  /** Default `<title>` used when a page does not pass one. */
  title: string;
  /** Short suffix used by Seo.astro for `<title>… · suffix`. */
  titleSuffix: string;
  /** Extra names search engines may treat as the same site. */
  alternateNames: string[];
  /** Absolute origin, no trailing slash. Used by robots.txt and feeds. */
  url: string;
  /** Attribution line appended to copied excerpts, per language. */
  licenseNotice: { zh: string; en: string };
  /** Titles and descriptions for the generated RSS/Atom feeds. */
  feeds: {
    blog: { title: string; description: string };
    novel: { title: string; description: string };
  };
  /** Desktop and mobile navigation, in display order. */
  nav: NavItem[];
}

export const siteConfig: SiteConfig = {
  title: 'FluentFolio · Personal Space',
  titleSuffix: 'FluentFolio',
  alternateNames: [...new Set([profile.nameShort, profile.nameZh, profile.nameEn, profile.name])],
  url: 'https://www.example.com',
  licenseNotice: {
    zh: '© 你的名字 版權所有，轉載請註明出處',
    en: '© Your Name. All rights reserved. Please credit the source when quoting.',
  },
  feeds: {
    blog: { title: 'FluentFolio Blog', description: 'FluentFolio 的開發、設計與實驗筆記。' },
    novel: { title: 'FluentFolio Novel', description: 'FluentFolio 的連載小說。' },
  },
  nav: [
    { href: '/', key: 'brand_home', exact: true },
    { href: '/posts', key: 'brand_posts', exact: false },
    { href: '/dictionary', key: 'brand_dictionary', exact: false },
    { href: '/world', key: 'brand_world', exact: false },
    { href: '/status', key: 'brand_status', exact: true },
    { href: '/about', key: 'brand_about', exact: true },
  ],
};
