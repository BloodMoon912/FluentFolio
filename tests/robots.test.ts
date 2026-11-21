import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AI_RESTRICTED_PREFIXES, type CrawlPolicyEntry } from '../src/lib/crawl-policy.ts';
import {
  AI_CRAWLER_GROUPS,
  CONTENT_SIGNAL,
  SEARCH_ENGINE_AGENTS,
  SITEMAP_URL,
  buildRobotsTxt,
} from '../src/lib/robots-txt.ts';

interface RobotsGroup {
  agents: string[];
  rules: Array<{ field: string; value: string }>;
}

/** Minimal RFC 9309 group parser: enough to assert on the emitted document. */
function parseGroups(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | undefined;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'user-agent') {
      // A rule after the agent lines closes the group; a later User-agent opens
      // a new one.
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value);
      continue;
    }

    // Sitemap is a file-level directive, not a group member.
    if (field === 'sitemap') continue;
    if (current) current.rules.push({ field, value });
  }

  return groups;
}

function rulesOf(groups: RobotsGroup[], field: string): string[] {
  return groups.flatMap((group) => group.rules.filter((rule) => rule.field === field).map((rule) => rule.value));
}

const aiAgents = new Set(AI_CRAWLER_GROUPS.flatMap((group) => group.agents));

/** Blog post, three published novel trial chapters, one blocked chapter. */
function fixture(): CrawlPolicyEntry[] {
  return [
    { id: 'hello-world', collection: 'blog' },
    { id: 'chapter-1', collection: 'novel', chapter: 1 },
    { id: 'chapter-2', collection: 'novel', chapter: 2 },
    { id: 'chapter-3', collection: 'novel', chapter: 3 },
    { id: 'chapter-4', collection: 'novel', chapter: 4 },
    { id: 'astral-sea', collection: 'dictionary' },
    { id: 'north-keep', collection: 'world' },
  ];
}

describe('buildRobotsTxt', () => {
  it('always emits the sitemap, the admin rule and the exact Content-Signal', () => {
    const text = buildRobotsTxt(fixture());

    assert.ok(text.includes(`Sitemap: ${SITEMAP_URL}`));
    assert.ok(text.includes('Disallow: /admin'));
    assert.ok(text.includes(`Content-Signal: ${CONTENT_SIGNAL}`));
    assert.ok(
      text.includes('Content-Signal: search=yes, ai-train=no, ai-input=no'),
      'the Content-Signal string is a published contract and must not drift',
    );
  });

  it('keeps the `*` group permissive for search engines', () => {
    const groups = parseGroups(buildRobotsTxt(fixture()));
    const wildcard = groups.find((group) => group.agents.includes('*'));

    assert.ok(wildcard, 'the document must contain a `User-agent: *` group');
    assert.deepEqual(
      wildcard.rules.filter((rule) => rule.field === 'allow').map((rule) => rule.value),
      ['/'],
    );
    assert.deepEqual(
      wildcard.rules.filter((rule) => rule.field === 'disallow').map((rule) => rule.value),
      ['/admin'],
    );
  });

  it('disallows every restricted prefix in every AI crawler group', () => {
    const groups = parseGroups(buildRobotsTxt(fixture()));
    const aiGroups = groups.filter((group) => group.agents.some((agent) => aiAgents.has(agent)));

    assert.ok(aiGroups.length > 0, 'AI crawler groups must be present');

    for (const group of aiGroups) {
      const disallowed = group.rules.filter((rule) => rule.field === 'disallow').map((rule) => rule.value);
      for (const prefix of AI_RESTRICTED_PREFIXES) {
        assert.ok(disallowed.includes(prefix), `${group.agents.join(', ')} is missing Disallow: ${prefix}`);
      }
    }
  });

  it('allows the three published trial chapters and not the fourth', () => {
    const groups = parseGroups(buildRobotsTxt(fixture()));
    const allowed = rulesOf(groups, 'allow');

    for (const chapter of ['chapter-1', 'chapter-2', 'chapter-3']) {
      assert.ok(allowed.includes(`/posts/novel/${chapter}/`), `trial chapter ${chapter} must be explicitly allowed`);
    }
    assert.ok(!allowed.includes('/posts/novel/chapter-4/'), 'a chapter past the trial must never be allowed');
  });

  it('makes the trial Allow more specific than the novel prefix Disallow', () => {
    const groups = parseGroups(buildRobotsTxt(fixture()));
    const allowed = rulesOf(groups, 'allow');
    const text = buildRobotsTxt(fixture());

    for (const chapter of ['chapter-1', 'chapter-2', 'chapter-3']) {
      const allow = `/posts/novel/${chapter}/`;
      assert.ok(text.includes(`Allow: ${allow}`));
      assert.ok(allow.startsWith('/posts/novel/'));
      assert.ok(
        allow.length > '/posts/novel/'.length,
        'longest-match resolution only works when the Allow path is longer',
      );
    }

    // A bare `/posts/novel/chapter-1` prefix would also whitelist chapter-10.
    const trialRules = allowed.filter((rule) => rule.startsWith('/posts/novel/'));
    assert.ok(
      !trialRules.some((rule) => '/posts/novel/chapter-10/'.startsWith(rule)),
      'the trial Allow must not become a prefix for later chapters',
    );
  });

  it('never places a search engine in a Disallow group', () => {
    const groups = parseGroups(buildRobotsTxt(fixture()));

    for (const group of groups) {
      const searchEngine = group.agents.find((agent) => (SEARCH_ENGINE_AGENTS as readonly string[]).includes(agent));
      if (!searchEngine) continue;

      const disallowed = group.rules.filter((rule) => rule.field === 'disallow');
      assert.equal(
        disallowed.length,
        0,
        `${searchEngine} must not receive a Disallow rule (got ${JSON.stringify(disallowed)})`,
      );
    }

    const text = buildRobotsTxt(fixture());
    for (const agent of SEARCH_ENGINE_AGENTS) {
      assert.ok(
        !new RegExp(`^User-agent: ${agent}$`, 'm').test(text),
        `${agent} must not appear as a user-agent group in robots.txt`,
      );
    }
  });

  it('stays valid when every collection is empty', () => {
    const text = buildRobotsTxt([]);
    const groups = parseGroups(text);

    assert.ok(text.includes('User-agent: *'));
    assert.ok(text.includes('Allow: /'));
    assert.ok(text.includes('Disallow: /admin'));
    assert.ok(text.includes(`Sitemap: ${SITEMAP_URL}`));
    assert.ok(text.includes('Content-Signal: search=yes, ai-train=no, ai-input=no'));

    for (const prefix of AI_RESTRICTED_PREFIXES) {
      assert.ok(text.includes(`Disallow: ${prefix}`));
    }
    assert.equal(
      rulesOf(groups, 'allow').filter((value) => value.startsWith('/posts/novel/')).length,
      0,
      'an empty site must not invent trial chapters',
    );
  });

  it('skips drafts and honours an explicit blocked override', () => {
    const entries: CrawlPolicyEntry[] = [
      { id: 'chapter-1', collection: 'novel', chapter: 1, draft: true },
      { id: 'secret-essay', collection: 'blog', override: 'blocked' },
      { id: 'premium-essay', collection: 'blog', override: 'paid' },
    ];
    const text = buildRobotsTxt(entries);

    assert.ok(!text.includes('/posts/novel/chapter-1'), 'a draft trial chapter must not be allowed');
    assert.ok(
      text.includes('Disallow: /posts/blog/secret-essay'),
      'a blog post overridden to blocked needs its own Disallow',
    );
    assert.ok(
      text.includes('Disallow: /posts/blog/premium-essay'),
      'paid behaves exactly like blocked until Pay Per Crawl is approved',
    );
  });

  it('does not duplicate a restricted path that a prefix already covers', () => {
    const text = buildRobotsTxt(fixture());
    const novelPrefixDisallows = text.split('\n').filter((line) => line === 'Disallow: /posts/novel/');

    // One per AI group, never one per chapter.
    assert.equal(novelPrefixDisallows.length, AI_CRAWLER_GROUPS.length);
  });
});
