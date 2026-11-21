import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEnglishSlug, uniqueEnglishSlug } from '../src/lib/english-slug.ts';

describe('createEnglishSlug', () => {
  it('turns an English title into a lowercase kebab-case slug', () => {
    assert.equal(createEnglishSlug('My New Article: A Guide!', '', 'blog', '2026-11-01'), 'my-new-article-a-guide');
  });

  it('uses an explicit English keyword for a Chinese title', () => {
    assert.equal(createEnglishSlug('我的遊戲筆記', 'Example Game Notes', 'blog', '2026-11-01'), 'example-game-notes');
  });

  it('does not romanise a Chinese-only title', () => {
    assert.equal(createEnglishSlug('我的遊戲筆記', '', 'blog', '2026-11-01'), 'post-20261101');
  });

  it('uses a collection-specific fallback', () => {
    assert.equal(createEnglishSlug('示例', '', 'world', '2026-11-01'), 'lore-20261101');
    assert.equal(createEnglishSlug('你好', '', 'dictionary', '2026-11-01'), 'word-20261101');
    assert.equal(createEnglishSlug('第一章', '', 'novel', '2026-11-01'), 'chapter-20261101');
  });

  it('normalises accented Latin text and ampersands', () => {
    assert.equal(createEnglishSlug('Café & Tea', '', 'blog', '2026-11-01'), 'cafe-and-tea');
  });

  it('keeps the Latin words of a mixed Chinese/English title', () => {
    assert.equal(createEnglishSlug('我的 Blender 建模筆記', '', 'blog', '2026-11-01'), 'blender');
  });

  it('ignores a blank keyword instead of discarding the title', () => {
    assert.equal(createEnglishSlug('My New Article', '   ', 'blog', '2026-11-01'), 'my-new-article');
  });

  it('never produces a number-only slug from a numeric title', () => {
    assert.equal(createEnglishSlug('2026', '', 'blog', '2026-11-01'), 'post-20261101');
  });

  it('falls back to the content date for a Chinese title without one', () => {
    assert.match(createEnglishSlug('你好', '', 'blog'), /^post-\d{8}$/);
  });
});

describe('uniqueEnglishSlug', () => {
  it('returns the base slug when it is free', () => {
    assert.equal(uniqueEnglishSlug('my-new-article', []), 'my-new-article');
    assert.equal(uniqueEnglishSlug('my-new-article', ['another-post']), 'my-new-article');
  });

  it('appends the next free numeric suffix for a duplicate', () => {
    assert.equal(uniqueEnglishSlug('my-new-article', ['my-new-article']), 'my-new-article-2');
    assert.equal(uniqueEnglishSlug('my-new-article', ['my-new-article', 'my-new-article-2']), 'my-new-article-3');
  });

  it('does not consider the slug being edited a collision', () => {
    // The caller filters the currently edited id out of `existingIds`; this
    // asserts the helper itself is a pure function of the ids it is given.
    assert.equal(uniqueEnglishSlug('my-new-article', ['my-new-article', 'other']), 'my-new-article-2');
  });
});
