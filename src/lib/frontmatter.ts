// Frontmatter parsing / serialization for blog posts.
//
// This is the single source of truth for the on-disk post format, and the
// online admin CMS is its only writer. The former local desktop CMS
// (scripts/cms/) was removed, so the 1:1 mirror requirement it used to impose
// no longer applies — but the emitted byte layout must stay stable, because
// existing files under src/content/blog/ are re-serialized verbatim on save.
//
// Hand-written on purpose (no gray-matter / yaml dependency) so this runs
// fine inside the Cloudflare Workers runtime with zero extra packages.
// It understands exactly the shape defined in src/content.config.ts.

import type { CrawlTier } from './crawl-policy.ts';

export interface PostFrontmatter {
  title: string;
  description: string;
  date: string; // YYYY-MM-DD
  type: string; // essay | note | ... (defaults to essay)
  updatedDate?: string;
  category: string;
  tags: string[];
  author: string;
  draft: boolean;
  featured: boolean;
  crawl?: CrawlTier;
  copyProtect?: boolean;
}

function stripQuotes(raw: string): string {
  const v = raw.trim();
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
  return v;
}

export function parseFrontmatter(raw: string): { data: Record<string, any>; body: string } {
  const normalized = raw.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: normalized };

  const [, fmBlock, body] = match;
  const lines = fmBlock.split('\n');
  const data: Record<string, any> = {};
  let currentListKey: string | null = null;

  for (const line of lines) {
    if (line.trim() === '') continue;

    const listItemMatch = line.match(/^\s{2,}-\s?(.*)$/);
    if (listItemMatch && currentListKey) {
      data[currentListKey].push(stripQuotes(listItemMatch[1]));
      continue;
    }

    const kvMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      const [, key, rest] = kvMatch;
      currentListKey = null;
      if (rest.trim() === '') {
        data[key] = [];
        currentListKey = key;
      } else if (rest.trim().startsWith('[')) {
        const inner = rest.trim().replace(/^\[/, '').replace(/\]$/, '');
        data[key] = inner
          .split(',')
          .map((s) => stripQuotes(s))
          .filter((s) => s.length > 0);
      } else if (rest.trim() === 'true' || rest.trim() === 'false') {
        data[key] = rest.trim() === 'true';
      } else {
        data[key] = stripQuotes(rest);
      }
    }
  }

  return { data, body: body.replace(/^\n/, '') };
}

function yamlEscape(str: unknown): string {
  return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function serializeFrontmatter(data: PostFrontmatter, body: string): string {
  const lines = ['---'];
  lines.push(`title: "${yamlEscape(data.title)}"`);
  lines.push(`description: "${yamlEscape(data.description)}"`);
  lines.push(`date: ${data.date}`);
  lines.push(`type: "${yamlEscape(data.type || 'essay')}"`);
  if (data.updatedDate) lines.push(`updatedDate: ${data.updatedDate}`);
  lines.push(`category: "${yamlEscape(data.category)}"`);
  if (Array.isArray(data.tags) && data.tags.length > 0) {
    lines.push('tags:');
    for (const tag of data.tags) lines.push(`  - ${tag}`);
  } else {
    lines.push('tags: []');
  }
  lines.push(`author: "${yamlEscape(data.author)}"`);
  if (data.crawl) lines.push(`crawl: ${data.crawl}`);
  if (typeof data.copyProtect === 'boolean') lines.push(`copyProtect: ${data.copyProtect ? 'true' : 'false'}`);
  if (data.featured) lines.push('featured: true');
  lines.push(`draft: ${data.draft ? 'true' : 'false'}`);
  lines.push('---');
  lines.push('');
  const trimmedBody = (body || '').replace(/^\n+/, '').replace(/\s+$/, '');
  return lines.join('\n') + trimmedBody + '\n';
}

/**
 * Build a full PostFrontmatter object from a parsed frontmatter `data`
 * object, applying `overrides` on top. Used by any operation that reads a
 * post via parseFrontmatter() and needs to write it back with a few fields
 * changed (tag rename/delete, batch operations) without repeating the same
 * field-by-field mapping in every route.
 */
export function dataToFrontmatter(
  data: Record<string, any>,
  overrides: Partial<PostFrontmatter> = {},
): PostFrontmatter {
  return {
    title: String(overrides.title ?? data.title ?? ''),
    description: String(overrides.description ?? data.description ?? ''),
    // `pubDate` is accepted as a read-only fallback so drafts written before the
    // 2026-10-25 rename still load; the serializer only ever writes `date`.
    date: String(overrides.date ?? data.date ?? data.pubDate ?? ''),
    type: String(overrides.type ?? data.type ?? 'essay'),
    updatedDate: overrides.updatedDate ?? (data.updatedDate ? String(data.updatedDate) : undefined),
    category: String(overrides.category ?? data.category ?? 'General'),
    tags: overrides.tags ?? (Array.isArray(data.tags) ? data.tags : []),
    author: String(overrides.author ?? data.author ?? 'Your Name'),
    draft: overrides.draft ?? Boolean(data.draft),
    featured: overrides.featured ?? Boolean(data.featured),
    crawl: overrides.crawl ?? normalizeCrawlTier(data.crawl),
    copyProtect: overrides.copyProtect ?? normalizeCopyProtect(data.copyProtect),
  };
}

/** Only the three known tiers survive a CMS round-trip; anything else is dropped. */
export function normalizeCrawlTier(value: unknown): CrawlTier | undefined {
  return value === 'open' || value === 'paid' || value === 'blocked' ? value : undefined;
}

/** Frontmatter booleans only; strings are normalised by the admin payload layer. */
export function normalizeCopyProtect(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return typeof slug === 'string' && slug.length > 0 && slug.length <= 200 && SLUG_PATTERN.test(slug);
}

// --- Generic content frontmatter (all four collections) -------------------
//
// The blog serializer above stays for the existing post endpoints. The CMS
// also manages novel/dictionary/world entries, whose shapes differ; this is the
// single serializer for those, with the field order taken from
// src/content.config.ts.

export type ContentCollection = 'blog' | 'novel' | 'dictionary' | 'world';

export const CONTENT_COLLECTIONS: readonly ContentCollection[] = ['blog', 'novel', 'dictionary', 'world'];

const CONTENT_FIELD_ORDER: Record<ContentCollection, readonly string[]> = {
  blog: [
    'title',
    'description',
    'date',
    'type',
    'updatedDate',
    'category',
    'tags',
    'author',
    'draft',
    'featured',
    'crawl',
    'copyProtect',
  ],
  novel: [
    'title',
    'volume',
    'chapter',
    'date',
    'order',
    'description',
    'relatedLore',
    'tags',
    'author',
    'draft',
    'crawl',
    'copyProtect',
  ],
  dictionary: [
    'word',
    'ipa',
    'partOfSpeech',
    'definition',
    'etymology',
    'relatedWords',
    'draft',
    'crawl',
    'copyProtect',
  ],
  world: ['title', 'type', 'description', 'relatedEntries', 'draft', 'crawl', 'copyProtect'],
};

function yamlScalar(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return `"${yamlEscape(value)}"`;
}

/**
 * Serialize a collection entry with the field order its schema expects. Unknown
 * keys are ignored, arrays become YAML lists, and strings are quoted so a colon
 * or quote in a title cannot break the frontmatter block.
 */
export function serializeContentFrontmatter(
  collection: ContentCollection,
  data: Record<string, unknown>,
  body: string,
): string {
  const lines = ['---'];
  for (const key of CONTENT_FIELD_ORDER[collection]) {
    const value = data[key];
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) lines.push(`  - ${yamlEscape(item)}`);
      }
      continue;
    }
    lines.push(`${key}: ${yamlScalar(value)}`);
  }
  lines.push('---');
  lines.push('');
  const trimmedBody = (body || '').replace(/^\n+/, '').replace(/\s+$/, '');
  return lines.join('\n') + trimmedBody + '\n';
}
