// Pure robots.txt builder. No Astro and no Cloudflare imports: the policy must
// be reproducible in a plain `node --test` process so the test suite can prove
// what the production route will emit.
//
// The policy itself (tiers, prefixes, trial chapters) lives in
// ./crawl-policy.ts — this module only renders it. See docs/CRAWLER-POLICY.md
// for what robots.txt can and cannot enforce.

import {
  AI_RESTRICTED_PREFIXES,
  restrictedPathsFor,
  trialNovelPathsFor,
  type CrawlPolicyEntry,
} from './crawl-policy.ts';

/** Must match `site` in astro.config.mjs. */
export const SITE_ORIGIN = 'https://www.example.com';

export const SITEMAP_URL = `${SITE_ORIGIN}/sitemap.xml`;

/**
 * Cloudflare's Content Signals Policy, verbatim. Search indexing stays allowed;
 * training and AI input are declined. Directives are advisory, not access
 * control — see docs/CRAWLER-POLICY.md.
 */
export const CONTENT_SIGNAL = 'search=yes, ai-train=no, ai-input=no';

export interface AiCrawlerGroup {
  /** Human label rendered as a robots.txt comment. */
  readonly label: string;
  /** robots.txt user-agent tokens, in the order they should be written. */
  readonly agents: readonly string[];
}

/**
 * AI crawler groups, split by what the crawler does. Every group receives the
 * same restricted prefixes and the same trial-chapter exceptions; the split
 * exists so the file (and the docs) can explain who is being blocked.
 *
 * Tokens are verified against vendor docs and Cloudflare's bot reference
 * (access date 2026-11-08, citations in docs/CRAWLER-POLICY.md §10):
 * - `Google-Extended` and `Applebot-Extended` are control tokens, not HTTP
 *   user agents; they only work through robots.txt.
 * - `anthropic-ai` is Anthropic's legacy token. Current Anthropic docs list
 *   ClaudeBot / Claude-User / Claude-SearchBot; the legacy token is kept so
 *   older deployments still match.
 * - `cohere-ai` has no current vendor crawler page; kept as a best-effort
 *   token and marked 「待確認」 in the docs.
 */
export const AI_CRAWLER_GROUPS: readonly AiCrawlerGroup[] = [
  {
    label: 'AI training crawlers',
    agents: [
      'GPTBot',
      'ClaudeBot',
      'anthropic-ai',
      'Google-Extended',
      'Applebot-Extended',
      'CCBot',
      'Bytespider',
      'Meta-ExternalAgent',
      'Amazonbot',
      'cohere-ai',
      'Diffbot',
    ],
  },
  {
    label: 'AI search / answer crawlers',
    agents: ['OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot'],
  },
  {
    label: 'User-triggered (agent) crawlers',
    agents: ['ChatGPT-User', 'Claude-User', 'Perplexity-User'],
  },
];

/**
 * Search engines that must never be listed in a Disallow group. Asserted by the
 * tests and by docs/CRAWLER-POLICY.md; blocking one would be an SEO regression.
 */
export const SEARCH_ENGINE_AGENTS = ['Googlebot', 'Bingbot', 'DuckDuckBot', 'Baiduspider', 'YandexBot'] as const;

function isCoveredByAiPrefix(path: string): boolean {
  return AI_RESTRICTED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Render the whole robots.txt document.
 *
 * Ordering: the `*` group first, then one group per AI category. `Allow` and
 * `Disallow` are matched by longest path, so `/posts/novel/chapter-1` (Allow)
 * wins over `/posts/novel/` (Disallow) without relying on rule order.
 *
 * `paid` entries render as `Disallow` today: the tier exists in
 * src/lib/crawl-policy.ts but Pay Per Crawl is still a closed beta. When the
 * programme is approved, this is the single place that switches `paid` to the
 * HTTP 402 / charge policy — robots.txt itself cannot express a price.
 */
export function buildRobotsTxt(entries: readonly CrawlPolicyEntry[], origin: string = SITE_ORIGIN): string {
  const sitemapUrl = `${origin.replace(/\/$/, '')}/sitemap.xml`;
  const trialPaths = trialNovelPathsFor(entries);
  const extraRestricted = restrictedPathsFor(entries)
    .map(({ path }) => path)
    .filter((path) => !isCoveredByAiPrefix(path));

  const lines: string[] = [
    '# Generated at build time by src/pages/robots.txt.ts.',
    '# Policy: src/lib/crawl-policy.ts. Explanation: docs/CRAWLER-POLICY.md.',
    '',
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    `Content-Signal: ${CONTENT_SIGNAL}`,
    `Sitemap: ${sitemapUrl}`,
    '',
  ];

  for (const group of AI_CRAWLER_GROUPS) {
    lines.push(`# ${group.label}`);
    for (const agent of group.agents) lines.push(`User-agent: ${agent}`);
    for (const prefix of AI_RESTRICTED_PREFIXES) lines.push(`Disallow: ${prefix}`);
    // Restricted entries outside the built-in prefixes (for example a blog post
    // whose frontmatter overrides the tier to `blocked` or `paid`).
    for (const path of extraRestricted) lines.push(`Disallow: ${path}`);
    // The trailing slash is deliberate: without it `/posts/novel/chapter-1`
    // would also allow `/posts/novel/chapter-10`, because the longer Allow rule
    // wins over the `/posts/novel/` Disallow. The slash makes the trial rule
    // match only that chapter's own URL prefix.
    for (const path of trialPaths) lines.push(`Allow: ${path}/`);
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
