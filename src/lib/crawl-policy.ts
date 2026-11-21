// Pure crawl-tier policy shared by the robots.txt route, the content schema and
// the unit tests. No Astro or Cloudflare imports: a crawler decision must stay
// reproducible outside a request.
//
// Tiers:
//   open    - blog, about, home, privacy, terms and the novel trial chapters.
//   trial   - the first NOVEL_TRIAL_CHAPTERS chapters; treated as open.
//   blocked - /world/*, /dictionary/* and novel chapters after the trial.
//   paid    - reserved for Pay Per Crawl; behaves exactly like blocked today.

import { z } from 'astro/zod';

export const CRAWL_TIERS = ['open', 'paid', 'blocked'] as const;

export type CrawlTier = (typeof CRAWL_TIERS)[number];

/** Schema shared with src/content.config.ts so tests cover the real enum. */
export const crawlTierSchema = z.enum(CRAWL_TIERS);

/** Chapters 1..N are the public trial; chapter N+1 onward is restricted. */
export const NOVEL_TRIAL_CHAPTERS = 3;

export type CrawlCollection = 'blog' | 'novel' | 'dictionary' | 'world';

export interface CrawlPolicyInput {
  collection: CrawlCollection;
  chapter?: number;
  override?: CrawlTier;
}

export interface CrawlPolicyEntry extends CrawlPolicyInput {
  id: string;
  draft?: boolean;
}

export interface RestrictedPath {
  path: string;
  tier: Exclude<CrawlTier, 'open'>;
}

/**
 * Resolve one entry's tier. `override` wins so a single frontmatter field can
 * open a restricted page or lock an otherwise public one. A novel entry without
 * a chapter is treated as restricted rather than accidentally public.
 */
export function crawlTierFor({ collection, chapter, override }: CrawlPolicyInput): CrawlTier {
  if (override) return override;
  if (collection === 'blog') return 'open';
  if (collection === 'novel') {
    return typeof chapter === 'number' && chapter <= NOVEL_TRIAL_CHAPTERS ? 'open' : 'blocked';
  }
  return 'blocked';
}

/** Public URL of one content entry, matching the routes under src/pages. */
export function contentPathFor(collection: CrawlCollection, id: string): string {
  if (collection === 'blog') return `/posts/blog/${id}`;
  if (collection === 'novel') return `/posts/novel/${id}`;
  return `/${collection}/${id}`;
}

/** Trade-off note: this is path policy, not a sitemap. */
export function restrictedPathsFor(entries: readonly CrawlPolicyEntry[]): RestrictedPath[] {
  const paths: RestrictedPath[] = [];
  for (const entry of entries) {
    if (entry.draft) continue;
    const tier = crawlTierFor(entry);
    if (tier === 'open') continue;
    paths.push({ path: contentPathFor(entry.collection, entry.id), tier });
  }
  return paths.sort((a, b) => a.path.localeCompare(b.path));
}

/** Trial chapter URLs that need an explicit Allow inside the novel Disallow. */
export function trialNovelPathsFor(entries: readonly CrawlPolicyEntry[]): string[] {
  return entries
    .filter(
      (entry) =>
        !entry.draft &&
        entry.collection === 'novel' &&
        crawlTierFor(entry) === 'open' &&
        typeof entry.chapter === 'number',
    )
    .map((entry) => contentPathFor('novel', entry.id))
    .sort();
}

/**
 * Prefixes that are fully restricted for AI crawlers. `/posts/novel/` is
 * deliberately broad so a chapter published later is blocked by default; the
 * trial chapters are re-allowed with their exact URLs (longest match wins).
 */
export const AI_RESTRICTED_PREFIXES = ['/posts/novel/', '/world/', '/dictionary/'] as const;
