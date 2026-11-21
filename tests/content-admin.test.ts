import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  draftKey,
  extractLoreTokens,
  isContentCollection,
  normalizeContentData,
  validateLoreReferences,
} from '../src/lib/content-admin.ts';

describe('content admin helpers', () => {
  it('recognises exactly the four collections', () => {
    for (const collection of ['blog', 'novel', 'dictionary', 'world']) {
      assert.equal(isContentCollection(collection), true);
    }
    assert.equal(isContentCollection('posts'), false);
    assert.equal(isContentCollection(null), false);
  });

  it('normalises a blog payload and lists missing required fields', () => {
    const blog = normalizeContentData('blog', {
      title: 'T',
      description: 'D',
      date: '2026-10-31',
      tags: 'a, b，c',
    });
    assert.deepEqual(blog.errors, []);
    assert.deepEqual(blog.data.tags, ['a', 'b', 'c']);
    assert.equal(blog.data.category, 'General');
    const bad = normalizeContentData('blog', { title: '', description: '', date: '' });
    assert.equal(bad.errors.length, 3);
  });

  it('normalises novel numbers and list fields', () => {
    const novel = normalizeContentData('novel', {
      title: 'chapter',
      chapter: '2',
      date: '2026-10-31',
      order: '5',
      relatedLore: ['a', 'b'],
    });
    assert.deepEqual(novel.errors, []);
    assert.equal(novel.data.chapter, 2);
    assert.equal(novel.data.order, 5);
    assert.deepEqual(novel.data.relatedLore, ['a', 'b']);
    const bad = normalizeContentData('novel', { title: 'x', chapter: '0', date: '2026-10-31' });
    assert.deepEqual(bad.errors, ['chapter must be a positive integer']);
  });

  it('validates dictionary/world required fields', () => {
    assert.equal(normalizeContentData('dictionary', { word: '', partOfSpeech: '', definition: '' }).errors.length, 3);
    assert.equal(normalizeContentData('world', { title: '', description: '' }).errors.length, 2);
  });

  it('extracts and validates [[lore]] tokens', () => {
    const body = 'See [[alpha]], [[beta]], [[alpha]] and [[gamma]]';
    assert.deepEqual(extractLoreTokens(body), ['alpha', 'beta', 'gamma']);
    assert.deepEqual(validateLoreReferences(body, ['alpha', 'beta']), ['[[gamma]] 沒有對應的詞典條目']);
  });

  it('namespaces drafts by collection', () => {
    assert.equal(draftKey('blog', 'same-id'), 'blog:same-id');
    assert.equal(draftKey('dictionary', 'same-id'), 'dictionary:same-id');
  });
});
