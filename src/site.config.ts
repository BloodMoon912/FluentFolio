// Typed loader for `site.config.json`.
//
// ALL site-specific data lives in that JSON file: identity, navigation, feeds,
// licence text, social links, About page rows, terminology and brand asset
// paths. Nothing here should need editing when the theme is upgraded — replace
// the JSON (or point CI at the private content repo that owns it) and the rest
// of the code stays identical.
//
// This module only validates and re-exports; it must stay dependency-light and
// must not touch the DOM or read environment variables.

import { z } from 'astro/zod';
import raw from '../site.config.json' with { type: 'json' };

const navItemSchema = z.object({
  href: z.string(),
  /** i18n key in src/i18n/ui.ts, e.g. `brand_posts`. */
  key: z.string(),
  /** `true` for pages that should only be active on their exact path. */
  exact: z.boolean(),
});

const setupRowSchema = z.object({ key: z.string(), value: z.string() });
const gameRowSchema = z.object({ name: z.string(), url: z.string(), key: z.string().optional() });

const siteConfigSchema = z.object({
  title: z.string(),
  titleSuffix: z.string(),
  url: z.string(),
  authorName: z.string(),
  adminName: z.string(),
  discordName: z.string(),
  webauthnSalt: z.string(),
  cmsSlug: z.string(),
  contactEmail: z.string(),
  alternateNames: z.array(z.string()),
  licenseNotice: z.object({ zh: z.string(), en: z.string() }),
  feeds: z.object({
    blog: z.object({ title: z.string(), description: z.string() }),
    novel: z.object({ title: z.string(), description: z.string() }),
  }),
  nav: z.array(navItemSchema),
  profile: z.object({
    name: z.string(),
    nameZh: z.string(),
    nameEn: z.string(),
    nameShort: z.string(),
    handle: z.string(),
    tagline: z.string(),
    bio: z.string(),
  }),
  services: z.array(z.object({ key: z.string(), id: z.string(), descId: z.string() })),
  socials: z.array(z.object({ name: z.string(), icon: z.string(), url: z.string() })),
  supportLinks: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      url: z.string(),
      image: z.string(),
      width: z.number(),
      height: z.number(),
      alt: z.string().optional(),
    }),
  ),
  about: z.object({ setup: z.array(setupRowSchema), games: z.array(gameRowSchema) }),
  terminology: z.object({ worldName: z.string(), conlangName: z.string() }),
  branding: z.object({
    logo: z.string(),
    favicon: z.string(),
    appleTouchIcon: z.string(),
    backgroundVideoWebm: z.string(),
    backgroundVideoMp4: z.string(),
    easterAudio: z.string(),
  }),
});

export type SiteConfig = z.infer<typeof siteConfigSchema>;
export type NavItem = z.infer<typeof navItemSchema>;
export type SupportLink = SiteConfig['supportLinks'][number];
export type AboutSetupRow = z.infer<typeof setupRowSchema>;
export type AboutGameRow = z.infer<typeof gameRowSchema>;

export const siteConfig: SiteConfig = siteConfigSchema.parse(raw);

export const profile = siteConfig.profile;
export const services = siteConfig.services;
export const socials = siteConfig.socials;
export const supportLinks: SupportLink[] = siteConfig.supportLinks;
export const aboutSetup: AboutSetupRow[] = siteConfig.about.setup;
export const aboutGames: AboutGameRow[] = siteConfig.about.games;
export const WORLD_NAME = siteConfig.terminology.worldName;
export const CONLANG_NAME = siteConfig.terminology.conlangName;
