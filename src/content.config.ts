import { siteConfig } from './site.config.ts';
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { crawlTierSchema } from './lib/crawl-policy';

// Content model for the unified /posts/ area plus the fiction wiki.
//
// This file is the single source of truth for every collection. `AGENTS.md`
// records the on-disk conventions; `src/lib/frontmatter.ts` mirrors the subset
// of the blog schema that the admin CMS writes.

/**
 * Essays and notes. `date` replaced the old `pubDate` on 2026-10-25 when the
 * blog moved under /posts/blog; the CMS writes the same field.
 */
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string().min(1),
    type: z.string().default('essay'),
    updatedDate: z.coerce.date().optional(),
    category: z.string().default('General'),
    tags: z.array(z.string()).default([]),
    author: z.string().default(siteConfig.authorName),
    draft: z.boolean().default(false),
    featured: z.boolean().default(false),
    // Optional per-entry overrides; absent means "use the collection default"
    // from src/lib/crawl-policy.ts / src/lib/copy-protection.ts.
    crawl: crawlTierSchema.optional(),
    copyProtect: z.boolean().optional(),
  }),
});

/**
 * Serialised fiction. One file per chapter; `order` drives reading order and
 * previous/next navigation, `relatedLore` links a chapter to dictionary and
 * world entries (the reverse index lives on those entries).
 */
const novel = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/novel' }),
  schema: z.object({
    title: z.string(),
    volume: z.string().default('第一卷'),
    chapter: z.number().int().positive(),
    date: z.coerce.date(),
    order: z.number().int().default(0),
    description: z.string().default(''),
    relatedLore: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    author: z.string().default(siteConfig.authorName),
    draft: z.boolean().default(false),
    crawl: crawlTierSchema.optional(),
    copyProtect: z.boolean().optional(),
  }),
});

/** Conlang dictionary entries. `relatedWords` holds other dictionary ids. */
const dictionary = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/dictionary' }),
  schema: z.object({
    word: z.string(),
    ipa: z.string().default(''),
    partOfSpeech: z.string(),
    definition: z.string().min(1),
    etymology: z.string().default(''),
    relatedWords: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    crawl: crawlTierSchema.optional(),
    copyProtect: z.boolean().optional(),
  }),
});

/** World-building encyclopedia entries: people, places, concepts, factions. */
const world = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/world' }),
  schema: z.object({
    title: z.string(),
    type: z.string().default('概念'),
    description: z.string().min(1),
    relatedEntries: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    crawl: crawlTierSchema.optional(),
    copyProtect: z.boolean().optional(),
  }),
});

export const collections = { blog, novel, dictionary, world };
