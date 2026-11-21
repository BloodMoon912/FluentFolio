import { siteConfig } from '../src/site.config.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseFrontmatter, serializeContentFrontmatter } from '../src/lib/frontmatter.ts';

describe('generic content frontmatter', () => {
  it('writes the novel field order and list fields', () => {
    const content = serializeContentFrontmatter(
      'novel',
      {
        title: 'Chapter "one"',
        volume: '第一卷',
        chapter: 4,
        date: '2026-10-31',
        order: 9,
        description: 'desc',
        relatedLore: ['alpha', 'beta'],
        tags: [],
        author: siteConfig.authorName,
        draft: true,
      },
      'Body text',
    );
    const { data, body } = parseFrontmatter(content);
    assert.equal(data.title, 'Chapter "one"');
    assert.equal(data.chapter, '4');
    assert.equal(data.order, '9');
    assert.deepEqual(data.relatedLore, ['alpha', 'beta']);
    assert.equal(data.draft, true);
    assert.equal(body.trim(), 'Body text');
    assert.match(content, /^---\ntitle:/);
  });

  it('serializes dictionary and world fields without leaking other keys', () => {
    const dictionary = serializeContentFrontmatter(
      'dictionary',
      {
        word: 'w',
        ipa: 'i',
        partOfSpeech: 'n',
        definition: 'd',
        etymology: '',
        relatedWords: [],
        draft: false,
        injected: 'x',
      },
      'body',
    );
    assert.equal(dictionary.includes('injected'), false);
    assert.match(dictionary, /word: "w"/);
    assert.match(dictionary, /relatedWords: \[\]/);

    const world = serializeContentFrontmatter(
      'world',
      { title: 't', type: 'place', description: 'd', relatedEntries: ['a'], draft: false },
      'body',
    );
    assert.match(world, /type: "place"/);
    assert.match(world, /relatedEntries:\n  - a/);
  });
});
