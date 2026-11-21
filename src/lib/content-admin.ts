import { siteConfig } from '../site.config.ts';
// Shared validation/normalisation for the four CMS collections. Pure module so
// both the API routes and the unit tests use the same rules; `frontmatter.ts`
// remains the serializer.

import type { CrawlTier } from './crawl-policy.ts';
import type { ContentCollection } from './frontmatter.ts';
import { CONTENT_COLLECTIONS } from './frontmatter.ts';

export function isContentCollection(value: string | null | undefined): value is ContentCollection {
  return typeof value === 'string' && (CONTENT_COLLECTIONS as readonly string[]).includes(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value).trim();
}

function asNumber(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

/**
 * Pass through the two optional policy fields instead of dropping them. They are
 * not editable in the CMS UI; this only keeps a hand-written frontmatter value
 * intact when the CMS rewrites the file.
 */
function policyFields(input: Record<string, unknown>): { crawl?: CrawlTier; copyProtect?: boolean } {
  const fields: { crawl?: CrawlTier; copyProtect?: boolean } = {};
  if (input.crawl === 'open' || input.crawl === 'paid' || input.crawl === 'blocked') {
    fields.crawl = input.crawl;
  }
  if (typeof input.copyProtect === 'boolean') {
    fields.copyProtect = input.copyProtect;
  } else if (input.copyProtect === 'true' || input.copyProtect === 'false') {
    fields.copyProtect = input.copyProtect === 'true';
  }
  return fields;
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(/[,，\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

export interface NormalizedContent {
  data: Record<string, unknown>;
  errors: string[];
}

/** Normalise an admin payload into the exact shape content.config.ts declares. */
export function normalizeContentData(collection: ContentCollection, input: Record<string, unknown>): NormalizedContent {
  const errors: string[] = [];
  const draft = asBoolean(input.draft);
  const shared = { draft, ...policyFields(input) };

  if (collection === 'blog') {
    const title = asString(input.title);
    const description = asString(input.description);
    const date = asString(input.date);
    if (!title) errors.push('title is required');
    if (!description) errors.push('description is required');
    if (!date) errors.push('date is required');
    return {
      data: {
        ...shared,
        title,
        description,
        date,
        type: asString(input.type) || 'essay',
        updatedDate: asString(input.updatedDate) || undefined,
        category: asString(input.category) || 'General',
        tags: asStringList(input.tags),
        author: asString(input.author) || siteConfig.authorName,
        featured: asBoolean(input.featured),
      },
      errors,
    };
  }

  if (collection === 'novel') {
    const title = asString(input.title);
    const chapter = asNumber(input.chapter, 0);
    const date = asString(input.date);
    if (!title) errors.push('title is required');
    if (!Number.isInteger(chapter) || chapter <= 0) errors.push('chapter must be a positive integer');
    if (!date) errors.push('date is required');
    return {
      data: {
        ...shared,
        title,
        volume: asString(input.volume) || '第一卷',
        chapter,
        date,
        order: asNumber(input.order, 0),
        description: asString(input.description),
        relatedLore: asStringList(input.relatedLore),
        tags: asStringList(input.tags),
        author: asString(input.author) || siteConfig.authorName,
      },
      errors,
    };
  }

  if (collection === 'dictionary') {
    const word = asString(input.word);
    const partOfSpeech = asString(input.partOfSpeech);
    const definition = asString(input.definition);
    if (!word) errors.push('word is required');
    if (!partOfSpeech) errors.push('partOfSpeech is required');
    if (!definition) errors.push('definition is required');
    return {
      data: {
        ...shared,
        word,
        ipa: asString(input.ipa),
        partOfSpeech,
        definition,
        etymology: asString(input.etymology),
        relatedWords: asStringList(input.relatedWords),
      },
      errors,
    };
  }

  const title = asString(input.title);
  const description = asString(input.description);
  if (!title) errors.push('title is required');
  if (!description) errors.push('description is required');
  return {
    data: {
      ...shared,
      title,
      type: asString(input.type) || '概念',
      description,
      relatedEntries: asStringList(input.relatedEntries),
    },
    errors,
  };
}

/** `[[word]]` tokens in a body, de-duplicated, in first-appearance order. */
export function extractLoreTokens(body: string): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    const token = match[1]?.trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

/**
 * Warning list for lore links that do not resolve to a dictionary id. This is a
 * pre-publish hint, not a hard block: the same check in validate-markdown.mjs is
 * still the CI gate.
 */
export function validateLoreReferences(body: string, dictionaryIds: readonly string[]): string[] {
  const known = new Set(dictionaryIds);
  return extractLoreTokens(body)
    .filter((token) => !known.has(token))
    .map((token) => `[[${token}]] 沒有對應的詞典條目`);
}

/** Drafts table key: one namespace per collection, so ids cannot collide. */
export function draftKey(collection: ContentCollection, id: string): string {
  return `${collection}:${id}`;
}
