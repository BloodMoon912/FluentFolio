/**
 * Build URL-safe English slugs without romanising Chinese titles.
 *
 * Latin words in a title (or an explicit English keyword) are preserved and
 * normalised to kebab-case. A title with no Latin letters receives a stable,
 * readable English collection prefix plus the content date instead of a
 * misleading pinyin slug.
 */
export type SlugCollection = 'blog' | 'novel' | 'dictionary' | 'world';

const COLLECTION_PREFIX: Record<SlugCollection, string> = {
  blog: 'post',
  novel: 'chapter',
  dictionary: 'word',
  world: 'lore',
};

function englishWords(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function compactDate(value?: string): string {
  const date = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date().toISOString().slice(0, 10);
  return date.replace(/-/g, '');
}

export function createEnglishSlug(
  title: string,
  englishKeyword: string,
  collection: SlugCollection,
  date?: string,
): string {
  const source = englishKeyword.trim() || title.trim();
  const candidate = englishWords(source);

  // Do not use number-only fragments such as "2026-03" as a title slug.
  if (/[a-z]/.test(candidate)) return candidate;

  return `${COLLECTION_PREFIX[collection]}-${compactDate(date)}`;
}

/**
 * Make a slug unique inside a collection by appending `-2`, `-3`, … .
 * The caller passes the ids that already exist, so an automatic slug can never
 * silently overwrite an existing URL.
 */
export function uniqueEnglishSlug(base: string, existingIds: Iterable<string>): string {
  const taken = new Set(existingIds);
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
