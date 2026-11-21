// Pure SEO builders shared by `src/layouts/BaseLayout.astro` and
// `src/components/Seo.astro`.
//
// Nothing in this module imports Astro: the layout resolves the current reading
// entry from `astro:content` and passes plain data in, so every function here is
// a deterministic value-in/value-out transform that `node --test` can exercise
// without a build.

/** Which schema.org shape an article page describes. */
export type ArticleKind = 'blog' | 'novel';

/**
 * Article-level metadata for a reading page (`/posts/blog/[slug]` or
 * `/posts/novel/[slug]`). Assembled by the layout from the content entry.
 */
export interface ArticleSeo {
  kind: ArticleKind;
  title: string;
  description: string;
  /** ISO 8601 timestamp, as produced by `Date.prototype.toISOString()`. */
  publishedTime: string;
  /** ISO 8601 timestamp; omitted when the entry has never been updated. */
  modifiedTime?: string;
  author: string;
  /** Blog category, or the novel volume. Mapped to `article:section`. */
  section: string;
  /** Mapped to one `article:tag` meta element per value. */
  tags: string[];
  /** 1-based chapter number; novel entries only. */
  position?: number;
}

/** Site-wide identity shared by the WebSite, BlogPosting and Chapter nodes. */
export interface SiteSeo {
  /** Production origin, e.g. `https://www.example.com`. */
  origin: string;
  /** JSON-LD `name` for the site itself. */
  name: string;
  /** Alternative names Google may treat as the same site. */
  alternateNames?: string[];
  /** BCP-47 tag, e.g. `zh-Hant`. */
  inLanguage?: string;
}

/**
 * Resolve a site-relative path against the canonical origin. Falls back to the
 * raw value when the origin is missing so a misconfigured `site` never throws
 * during rendering.
 */
export function absoluteUrl(path: string, origin: string): string {
  try {
    return new URL(path, origin).toString();
  } catch {
    return path;
  }
}

/**
 * `JSON.stringify` that cannot terminate the surrounding `<script>` element.
 * `<`, `>` and `&` are escaped, as are the two JavaScript line terminators that
 * are legal inside JSON strings but illegal in a script body.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** schema.org `WebSite` node — emitted on the homepage only. */
export function buildWebsiteJsonLd(site: SiteSeo, description: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: site.name,
    alternateName: site.alternateNames ?? [],
    url: site.origin,
    description,
    inLanguage: site.inLanguage ?? 'zh-Hant',
  };
}

/**
 * schema.org node for a reading page: `BlogPosting` for essays, `Chapter` for
 * novel chapters (with the volume as its `isPartOf` Book).
 */
export function buildArticleJsonLd(
  article: ArticleSeo,
  options: { site: SiteSeo; pageUrl: string; imageUrl: string },
): Record<string, unknown> {
  const { site, pageUrl, imageUrl } = options;
  const author = { '@type': 'Person', name: article.author };
  const mainEntityOfPage = { '@type': 'WebPage', '@id': pageUrl };

  if (article.kind === 'novel') {
    return {
      '@context': 'https://schema.org',
      '@type': 'Chapter',
      name: article.title,
      headline: article.title,
      description: article.description,
      ...(article.position === undefined ? {} : { position: article.position }),
      datePublished: article.publishedTime,
      dateModified: article.modifiedTime ?? article.publishedTime,
      author,
      mainEntityOfPage,
      image: imageUrl,
      url: pageUrl,
      inLanguage: site.inLanguage ?? 'zh-Hant',
      isPartOf: { '@type': 'Book', name: article.section },
      ...(article.tags.length ? { keywords: article.tags.join(', ') } : {}),
    };
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: article.title,
    description: article.description,
    datePublished: article.publishedTime,
    dateModified: article.modifiedTime ?? article.publishedTime,
    author,
    publisher: { '@type': 'Organization', name: site.name, url: site.origin },
    mainEntityOfPage,
    image: imageUrl,
    url: pageUrl,
    inLanguage: site.inLanguage ?? 'zh-Hant',
    articleSection: article.section,
    ...(article.tags.length ? { keywords: article.tags.join(', ') } : {}),
  };
}
