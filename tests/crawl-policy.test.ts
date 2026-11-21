import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AI_RESTRICTED_PREFIXES,
  NOVEL_TRIAL_CHAPTERS,
  contentPathFor,
  crawlTierFor,
  crawlTierSchema,
  restrictedPathsFor,
  trialNovelPathsFor,
  type CrawlPolicyEntry,
} from '../src/lib/crawl-policy.ts';

const ENTRIES: CrawlPolicyEntry[] = [
  { id: 'hello-world', collection: 'blog' },
  { id: 'chapter-1', collection: 'novel', chapter: 1 },
  { id: 'chapter-3', collection: 'novel', chapter: 3 },
  { id: 'chapter-4', collection: 'novel', chapter: 4 },
  { id: 'chapter-9-draft', collection: 'novel', chapter: 9, draft: true },
  { id: 'aether', collection: 'dictionary' },
  { id: 'the-crimson-court', collection: 'world' },
  { id: 'paid-preview', collection: 'world', override: 'paid' },
  { id: 'open-note', collection: 'dictionary', override: 'open' },
];

describe('crawlTierFor', () => {
  it('keeps blog posts open and world/dictionary blocked by default', () => {
    assert.equal(crawlTierFor({ collection: 'blog' }), 'open');
    assert.equal(crawlTierFor({ collection: 'dictionary' }), 'blocked');
    assert.equal(crawlTierFor({ collection: 'world' }), 'blocked');
  });

  it('opens exactly the first NOVEL_TRIAL_CHAPTERS chapters', () => {
    assert.equal(NOVEL_TRIAL_CHAPTERS, 3);
    assert.equal(crawlTierFor({ collection: 'novel', chapter: 1 }), 'open');
    assert.equal(crawlTierFor({ collection: 'novel', chapter: 3 }), 'open');
    assert.equal(crawlTierFor({ collection: 'novel', chapter: 4 }), 'blocked');
  });

  it('treats a novel entry without a chapter as restricted', () => {
    assert.equal(crawlTierFor({ collection: 'novel' }), 'blocked');
  });

  it('lets a frontmatter override win in both directions', () => {
    assert.equal(crawlTierFor({ collection: 'world', override: 'open' }), 'open');
    assert.equal(crawlTierFor({ collection: 'blog', override: 'blocked' }), 'blocked');
    assert.equal(crawlTierFor({ collection: 'novel', chapter: 1, override: 'paid' }), 'paid');
  });
});

describe('crawlTierSchema', () => {
  it('accepts the three tiers and rejects anything else', () => {
    for (const tier of ['open', 'paid', 'blocked']) {
      assert.equal(crawlTierSchema.safeParse(tier).success, true);
    }
    for (const invalid of ['trial', 'Open', '', 'closed']) {
      assert.equal(crawlTierSchema.safeParse(invalid).success, false);
    }
  });
});

describe('restrictedPathsFor', () => {
  it('lists blocked and paid URLs, skipping drafts and open entries', () => {
    assert.deepEqual(restrictedPathsFor(ENTRIES), [
      { path: '/dictionary/aether', tier: 'blocked' },
      { path: '/posts/novel/chapter-4', tier: 'blocked' },
      { path: '/world/paid-preview', tier: 'paid' },
      { path: '/world/the-crimson-court', tier: 'blocked' },
    ]);
  });

  it('uses the public route shape for every collection', () => {
    assert.equal(contentPathFor('blog', 'x'), '/posts/blog/x');
    assert.equal(contentPathFor('novel', 'x'), '/posts/novel/x');
    assert.equal(contentPathFor('dictionary', 'x'), '/dictionary/x');
    assert.equal(contentPathFor('world', 'x'), '/world/x');
  });
});

describe('trialNovelPathsFor', () => {
  it('returns only published trial chapters', () => {
    assert.deepEqual(trialNovelPathsFor(ENTRIES), ['/posts/novel/chapter-1', '/posts/novel/chapter-3']);
  });
});

describe('AI_RESTRICTED_PREFIXES', () => {
  it('covers novel and both wiki collections', () => {
    assert.deepEqual([...AI_RESTRICTED_PREFIXES], ['/posts/novel/', '/world/', '/dictionary/']);
  });
});
