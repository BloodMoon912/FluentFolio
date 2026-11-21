// Shared search engine: the one place that knows how to load the index, how
// Fuse is configured, how a query is filtered by content type, and how matches
// are highlighted. Both the shell search (SiteSearch) and the admin CMS list
// use this module, so there are no second implementations to drift.
//
// Pure module: no Astro or DOM imports beyond the escape helper, so it can be
// imported by tests and by the browser bundle alike.

import Fuse, { type IFuseOptions } from 'fuse.js';
import { escapeHtml } from './escape-html.ts';

export type SearchKind = 'blog' | 'novel' | 'dictionary' | 'world';

export const SEARCH_KINDS: readonly SearchKind[] = ['blog', 'novel', 'dictionary', 'world'];

export const SEARCH_KIND_I18N: Record<SearchKind, string> = {
  blog: 'search_kind_blog',
  novel: 'search_kind_novel',
  dictionary: 'search_kind_dictionary',
  world: 'search_kind_world',
};

export interface SearchDocument {
  kind: SearchKind;
  id: string;
  title: string;
  description: string;
  tags: string[];
  /** Optional structured facets and precomputed romanisation fields. */
  category?: string;
  pinyin?: string;
  pinyinInitials?: string;
  /** Initials without spaces, so a continuous query like `zw` still matches. */
  pinyinInitialsCompact?: string;
  pinyinCompact?: string;
  jyutping?: string;
  /** Tone-insensitive Jyutping for queries entered without tone numbers. */
  jyutpingNoTone?: string;
  jyutpingCompact?: string;
  jyutpingNoToneCompact?: string;
  keywords?: string[];
  url: string;
}

export interface SearchEngine {
  readonly documents: SearchDocument[];
  /** Ranked matches; `kind` narrows the result set before ranking. */
  search(query: string, kind?: SearchKind, tag?: string): SearchDocument[];
  /** A couple of newest entries per kind for the pre-query preview. */
  preview(kind?: SearchKind): SearchDocument[];
}

export const INDEX_URL = '/search-index.json';

// Fuzzy, but not so loose that unrelated entries drown the hits.
export const FUSE_OPTIONS: IFuseOptions<SearchDocument> = {
  threshold: 0.38,
  ignoreLocation: true,
  minMatchCharLength: 1,
  keys: [
    { name: 'title', weight: 0.6 },
    { name: 'tags', weight: 0.25 },
    { name: 'description', weight: 0.12 },
    { name: 'pinyin', weight: 0.38 },
    { name: 'pinyinInitials', weight: 0.22 },
    { name: 'pinyinInitialsCompact', weight: 0.22 },
    { name: 'pinyinCompact', weight: 0.32 },
    { name: 'jyutping', weight: 0.38 },
    { name: 'jyutpingNoTone', weight: 0.34 },
    { name: 'jyutpingCompact', weight: 0.32 },
    { name: 'jyutpingNoToneCompact', weight: 0.3 },
    { name: 'keywords', weight: 0.12 },
  ],
};

export function isSearchDocument(value: unknown): value is SearchDocument {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<SearchDocument>;
  return (
    typeof candidate.kind === 'string' &&
    (SEARCH_KINDS as readonly string[]).includes(candidate.kind) &&
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.description === 'string' &&
    // `tags` is read with `.includes()` for the tag facet, so a document without
    // it would turn a bad/old payload into a TypeError at query time.
    Array.isArray(candidate.tags) &&
    typeof candidate.url === 'string'
  );
}

export function normalizeSearchQuery(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function createSearchEngine(documents: SearchDocument[]): SearchEngine {
  const fuse = documents.length > 0 ? new Fuse(documents, FUSE_OPTIONS) : null;

  function byKind(kind?: SearchKind, tag?: string): SearchDocument[] {
    return documents.filter((document) => (!kind || document.kind === kind) && (!tag || document.tags.includes(tag)));
  }

  return {
    documents,
    search(query, kind, tag) {
      const normalized = normalizeSearchQuery(query);
      if (!normalized) return byKind(kind, tag);
      const results = fuse ? fuse.search(normalized).map((result) => result.item) : [];
      return results.filter((document) => (!kind || document.kind === kind) && (!tag || document.tags.includes(tag)));
    },
    preview(kind) {
      const order = kind ? [kind] : SEARCH_KINDS;
      const picked: SearchDocument[] = [];
      for (const oneKind of order) {
        picked.push(...documents.filter((document) => document.kind === oneKind).slice(0, 2));
      }
      return picked;
    },
  };
}

let enginePromise: Promise<SearchEngine> | null = null;

/**
 * One shared index request for every search instance on the page. A failure
 * clears the promise so a later focus can retry instead of reusing a rejected
 * request.
 */
export function getSearchEngine(fetcher: typeof fetch = fetch): Promise<SearchEngine> {
  if (!enginePromise) {
    enginePromise = fetcher(INDEX_URL, { headers: { Accept: 'application/json' } })
      .then((response) => {
        if (!response.ok) throw new Error(`search-index.json responded ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        const documents = Array.isArray(payload) ? payload.filter(isSearchDocument) : [];
        return createSearchEngine(documents);
      })
      .catch((error: unknown) => {
        enginePromise = null;
        throw error;
      });
  }
  return enginePromise;
}

/** Reset the shared promise; used by tests and by a retry path. */
export function resetSearchEngine(): void {
  enginePromise = null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Escape text for HTML, then wrap query tokens in <mark>. The tokens are matched
 * against the raw text and every segment is escaped individually, so a query
 * containing `&` (or matching the letters of an entity like `amp`) can never
 * split an HTML entity produced by the escape step. The query is treated as
 * literal text, not a regex.
 */
export function highlight(text: string, query: string): string {
  const tokens = normalizeSearchQuery(query).split(' ').filter(Boolean).map(escapeRegExp);
  if (tokens.length === 0) return escapeHtml(text);
  const pattern = new RegExp(`(${tokens.join('|')})`, 'gi');
  let markup = '';
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    markup += escapeHtml(text.slice(cursor, index));
    markup += `<mark>${escapeHtml(match[0])}</mark>`;
    cursor = index + match[0].length;
  }
  return markup + escapeHtml(text.slice(cursor));
}

export interface SearchState {
  query: string;
  kind: SearchKind | null;
  tag: string;
}

/** Read `?q=` / `?type=` from an existing query string. Unknown types become null. */
export function parseSearchState(search: string | URLSearchParams): SearchState {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const rawKind = params.get('type');
  const kind = (SEARCH_KINDS as readonly string[]).includes(rawKind ?? '') ? (rawKind as SearchKind) : null;
  return { query: (params.get('q') ?? '').trim(), kind, tag: (params.get('tag') ?? '').trim() };
}

/** Build a same-page search URL while preserving unrelated params (e.g. tab). */
export function searchHref(
  basePath: string,
  state: { query?: string; kind?: SearchKind | null; tag?: string } = {},
  currentSearch = '',
): string {
  const params = new URLSearchParams(currentSearch);
  const query = (state.query ?? '').trim();
  if (query) params.set('q', query);
  else params.delete('q');
  if (state.kind) params.set('type', state.kind);
  else params.delete('type');
  const tag = (state.tag ?? '').trim();
  if (tag) params.set('tag', tag);
  else params.delete('tag');
  const suffix = params.toString();
  return suffix ? `${basePath}?${suffix}` : basePath;
}
