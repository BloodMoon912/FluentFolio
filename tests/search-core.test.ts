import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createSearchEngine,
  highlight,
  isSearchDocument,
  normalizeSearchQuery,
  parseSearchState,
  searchHref,
  type SearchDocument,
} from '../src/lib/search-core.ts';

const documents: SearchDocument[] = [
  {
    kind: 'blog',
    id: 'hello',
    title: 'Hello <world>',
    description: 'An & essay',
    tags: ['daily'],
    url: '/posts/blog/hello',
  },
  {
    kind: 'novel',
    id: 'chapter-1',
    title: '第一章',
    description: '開始',
    tags: ['第一卷'],
    pinyin: 'di yi zhang',
    pinyinInitials: 'd y z',
    pinyinInitialsCompact: 'dyz',
    pinyinCompact: 'diyizhang',
    jyutping: 'dai6 jat1 zoeng1',
    jyutpingNoTone: 'dai jat zoeng',
    jyutpingCompact: 'dai6jat1zoeng1',
    jyutpingNoToneCompact: 'daijatzoeng',
    url: '/posts/novel/chapter-1',
  },
  {
    kind: 'dictionary',
    id: 'word',
    title: '詞',
    description: '一個詞',
    tags: [],
    url: '/dictionary/word',
  },
];

describe('search core', () => {
  it('ranks and filters by kind', () => {
    const engine = createSearchEngine(documents);
    const all = engine.search('詞');
    assert.ok(all.some((doc) => doc.id === 'word'));
    assert.equal(engine.search('詞', 'blog').length, 0);
    assert.equal(engine.search('', 'novel')[0]?.id, 'chapter-1');
    assert.equal(engine.search('', 'blog', 'daily')[0]?.id, 'hello');
    assert.equal(engine.search('hello', 'blog', 'daily')[0]?.id, 'hello');
    assert.equal(engine.search('', 'blog', 'missing').length, 0);
    assert.equal(engine.search('dyz', 'novel')[0]?.id, 'chapter-1');
    assert.equal(engine.search('d y z', 'novel')[0]?.id, 'chapter-1');
    assert.equal(engine.search('dai6 jat1 zoeng1', 'novel')[0]?.id, 'chapter-1');
    assert.equal(engine.search('dai jat zoeng', 'novel')[0]?.id, 'chapter-1');
    assert.equal(engine.search('diyizhang', 'novel')[0]?.id, 'chapter-1');
    assert.equal(engine.search('daijatzoeng', 'novel')[0]?.id, 'chapter-1');
  });

  it('previews up to two entries per kind', () => {
    const engine = createSearchEngine(documents);
    assert.equal(engine.preview().length, 3);
    assert.deepEqual(
      engine.preview('blog').map((doc) => doc.id),
      ['hello'],
    );
  });

  it('escapes HTML before wrapping query tokens in mark', () => {
    assert.equal(highlight('Hello <world>', 'world'), 'Hello &lt;<mark>world</mark>&gt;');
    assert.equal(highlight('A & B', 'b'), 'A &amp; <mark>B</mark>');
    assert.equal(highlight('safe', 'a.*'), 'safe');
    // A token that is (or sits inside) an HTML entity must stay escaped: matching
    // the escaped string directly would emit `<mark>&</mark>amp;`.
    assert.equal(highlight('A & B', '&'), 'A <mark>&amp;</mark> B');
    assert.equal(highlight('A &amp; B', 'amp'), 'A &amp;<mark>amp</mark>; B');
  });

  it('normalizes queries and parses ?q/?type/?tag', () => {
    assert.equal(normalizeSearchQuery('  Foo   Bar  '), 'Foo Bar');
    assert.deepEqual(parseSearchState('?q=hello&type=novel'), { query: 'hello', kind: 'novel', tag: '' });
    assert.deepEqual(parseSearchState('?q=hello&type=nope'), { query: 'hello', kind: null, tag: '' });
    assert.deepEqual(parseSearchState('?tag=daily'), { query: '', kind: null, tag: 'daily' });
  });

  it('builds search URLs while preserving the tab param', () => {
    assert.equal(searchHref('/posts', { query: 'x' }, 'tab=novel'), '/posts?tab=novel&q=x');
    assert.equal(searchHref('/posts', { query: 'x', tag: 'daily' }, 'tab=blog'), '/posts?tab=blog&q=x&tag=daily');
    assert.equal(searchHref('/posts', { query: '', kind: null }, 'tab=novel&q=x'), '/posts?tab=novel');
    assert.equal(searchHref('/dictionary', { query: 'a', kind: 'dictionary' }), '/dictionary?q=a&type=dictionary');
  });

  it('rejects malformed index documents', () => {
    assert.equal(isSearchDocument({ kind: 'blog', id: 'x', title: 't', description: '', tags: [], url: '/x' }), true);
    assert.equal(isSearchDocument({ kind: 'unknown', id: 'x', title: 't', description: '', url: '/x' }), false);
    assert.equal(isSearchDocument({ kind: 'blog', id: 1, title: 't', description: '', url: '/x' }), false);
    // `tags` is required: the tag facet calls `.includes()` on it.
    assert.equal(isSearchDocument({ kind: 'blog', id: 'x', title: 't', description: '', url: '/x' }), false);
    assert.equal(
      isSearchDocument({ kind: 'blog', id: 'x', title: 't', description: '', tags: 'daily', url: '/x' }),
      false,
    );
  });
});
