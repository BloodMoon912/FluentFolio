import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { chapterLabel } from '../lib/content-feed';
import { pinyin } from 'pinyin-pro';
import ToJyutping from 'to-jyutping';

// Whole-site search index for <SiteSearch />.
//
// The site runs `output: 'server'`, but this route is the one thing that must
// not be rendered per request: it walks all four collections, and doing that on
// the Worker would turn every focus-triggered fetch into a content lookup at the
// edge. `prerender = true` emits a static JSON file at build time instead, so the
// browser downloads a plain asset that the static-asset layer can cache — no
// Worker invocation, no budget spent.
//
// Shape (one entry per published document, drafts excluded everywhere):
//   { kind, id, title, description, tags, category, pinyin variants, Jyutping variants, keywords, url }
// Romanisation is precomputed at build time so browser search stays local and
// does not need a large pronunciation dictionary at runtime. Blog category and
// tags remain separate so the tag facet can filter only actual tags.

export const prerender = true;

type SearchKind = 'blog' | 'novel' | 'dictionary' | 'world';

interface SearchDocument {
  kind: SearchKind;
  id: string;
  title: string;
  description: string;
  tags: string[];
  category?: string;
  pinyin: string;
  pinyinInitials: string;
  pinyinInitialsCompact: string;
  pinyinCompact: string;
  jyutping: string;
  jyutpingNoTone: string;
  jyutpingCompact: string;
  jyutpingNoToneCompact: string;
  keywords: string[];
  url: string;
}

/** Trim, drop empties and de-duplicate, so `tags` never carries blanks. */
function cleanTags(...values: (string | undefined)[]): string[] {
  const tags = new Set<string>();
  for (const value of values) {
    const tag = (value ?? '').trim();
    if (tag) tags.add(tag);
  }
  return [...tags];
}

/**
 * Build a route from an entry id.
 *
 * Ids come from the glob loader and are therefore relative paths; encoding each
 * segment separately keeps a nested id (`character/ash`) a nested route while
 * still percent-encoding non-ASCII ids (the dictionary is full of them).
 */
function romanisation(
  text: string,
): Pick<
  SearchDocument,
  | 'pinyin'
  | 'pinyinInitials'
  | 'pinyinInitialsCompact'
  | 'pinyinCompact'
  | 'jyutping'
  | 'jyutpingNoTone'
  | 'jyutpingCompact'
  | 'jyutpingNoToneCompact'
> {
  const source = text.normalize('NFKC');
  const pinyinText = pinyin(source, { toneType: 'none', traditional: true, nonZh: 'consecutive' });
  const pinyinInitials = pinyin(source, { pattern: 'first', toneType: 'none', traditional: true, nonZh: 'removed' });
  const jyutpingParts = ToJyutping.getJyutpingList(source) as Array<[string, string | null]>;
  const jyutping = jyutpingParts
    .map((part) => part[1])
    .filter((part): part is string => Boolean(part))
    .join(' ');
  const jyutpingNoTone = jyutping.replace(/[1-6]/g, '');
  return {
    pinyin: pinyinText,
    pinyinInitials,
    // `pinyinInitials` is space-separated (`z w`), which a continuous initials
    // query (`zw`) cannot fuzzy-match, so store the compact form too.
    pinyinInitialsCompact: pinyinInitials.replace(/\s+/g, ''),
    pinyinCompact: pinyinText.replace(/\s+/g, ''),
    jyutping,
    jyutpingNoTone,
    jyutpingCompact: jyutping.replace(/\s+/g, ''),
    jyutpingNoToneCompact: jyutpingNoTone.replace(/\s+/g, ''),
  };
}

function entryUrl(prefix: string, id: string): string {
  const path = id
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${prefix}${path}`;
}

export const GET: APIRoute = async () => {
  const [blog, novel, dictionary, world] = await Promise.all([
    getCollection('blog', ({ data }) => !data.draft),
    getCollection('novel', ({ data }) => !data.draft),
    getCollection('dictionary', ({ data }) => !data.draft),
    getCollection('world', ({ data }) => !data.draft),
  ]);

  // Newest first inside each collection; the client keeps this order for the
  // "everything" preview it shows before the visitor types anything.
  const blogDocuments: SearchDocument[] = blog
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
    .map((entry): SearchDocument => ({
      kind: 'blog',
      id: entry.id,
      title: entry.data.title,
      description: entry.data.description,
      tags: cleanTags(...entry.data.tags),
      category: entry.data.category,
      keywords: cleanTags(entry.data.type, entry.data.category),
      ...romanisation(
        [entry.data.title, entry.data.description, entry.data.type, entry.data.category, ...entry.data.tags].join(' '),
      ),
      url: entryUrl('/posts/blog/', entry.id),
    }));

  const novelDocuments: SearchDocument[] = novel
    .sort((a, b) => a.data.order - b.data.order || a.data.chapter - b.data.chapter)
    .map((entry): SearchDocument => ({
      kind: 'novel',
      id: entry.id,
      title: entry.data.title,
      // The novel schema allows an empty description; the chapter label is a
      // better hit target than an empty string.
      description: entry.data.description || chapterLabel(entry.data.volume, entry.data.chapter),
      tags: cleanTags(...entry.data.tags),
      keywords: cleanTags(entry.data.volume),
      ...romanisation([entry.data.title, entry.data.description, entry.data.volume, ...entry.data.tags].join(' ')),
      url: entryUrl('/posts/novel/', entry.id),
    }));

  const dictionaryDocuments: SearchDocument[] = dictionary
    .sort((a, b) => a.data.word.localeCompare(b.data.word))
    .map((entry): SearchDocument => ({
      kind: 'dictionary',
      id: entry.id,
      // A dictionary entry is keyed by its word, not by a `title` field.
      title: entry.data.word,
      description: entry.data.definition,
      tags: [],
      keywords: cleanTags(entry.data.partOfSpeech, entry.data.ipa, entry.data.etymology),
      ...romanisation([entry.data.word, entry.data.definition, entry.data.partOfSpeech].join(' ')),
      url: entryUrl('/dictionary/', entry.id),
    }));

  const worldDocuments: SearchDocument[] = world
    .sort((a, b) => a.data.title.localeCompare(b.data.title, 'zh-Hant'))
    .map((entry): SearchDocument => ({
      kind: 'world',
      id: entry.id,
      title: entry.data.title,
      description: entry.data.description,
      tags: [],
      keywords: cleanTags(entry.data.type),
      ...romanisation([entry.data.title, entry.data.description, entry.data.type].join(' ')),
      url: entryUrl('/world/', entry.id),
    }));

  const documents: SearchDocument[] = [...blogDocuments, ...novelDocuments, ...dictionaryDocuments, ...worldDocuments];

  return new Response(JSON.stringify(documents), {
    headers: {
      // Set here for `astro dev`, and for any serving path that honours the
      // response headers of a prerendered route. In production the file is
      // served as a static asset, where the cache policy comes from
      // `public/_headers`.
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
