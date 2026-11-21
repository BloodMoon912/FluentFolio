import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  dataToFrontmatter,
  isValidSlug,
  parseFrontmatter,
  serializeContentFrontmatter,
  serializeFrontmatter,
} from '../src/lib/frontmatter.ts';
import type { PostFrontmatter } from '../src/lib/frontmatter.ts';

const FULL: PostFrontmatter = {
  title: 'A "quoted" title',
  description: 'A description',
  date: '2026-01-02',
  type: 'essay',
  category: 'Tech',
  tags: ['alpha', 'beta'],
  author: 'Your Name',
  draft: false,
  featured: true,
};

describe('parseFrontmatter', () => {
  it('returns the whole document as body when there is no frontmatter block', () => {
    assert.deepEqual(parseFrontmatter('plain body'), { data: {}, body: 'plain body' });
  });

  it('parses quoted scalars, booleans, block lists and inline lists', () => {
    const source = ['---', 'title: "Hello"', 'draft: true', 'tags:', '  - alpha', '  - beta', '---', 'body text'].join(
      '\n',
    );
    const { data, body } = parseFrontmatter(source);
    assert.equal(data.title, 'Hello');
    assert.equal(data.draft, true);
    assert.deepEqual(data.tags, ['alpha', 'beta']);
    assert.equal(body, 'body text');
  });

  it('parses an inline list and drops empty entries', () => {
    const { data } = parseFrontmatter('---\ntags: [a, , b]\n---\nbody');
    assert.deepEqual(data.tags, ['a', 'b']);
  });

  it('normalizes CRLF line endings', () => {
    const { data } = parseFrontmatter('---\r\ntitle: "x"\r\n---\r\nbody');
    assert.equal(data.title, 'x');
  });

  it('unquotes escaped double quotes', () => {
    const { data } = parseFrontmatter('---\ntitle: "say \\"hi\\""\n---\nbody');
    assert.equal(data.title, 'say "hi"');
  });
});

describe('serializeFrontmatter', () => {
  it('emits the documented key order and escapes double quotes', () => {
    const out = serializeFrontmatter(FULL, 'Body line\n');
    const lines = out.split('\n');
    assert.equal(lines[0], '---');
    assert.equal(lines[1], 'title: "A \\"quoted\\" title"');
    assert.equal(lines[2], 'description: "A description"');
    assert.equal(lines[3], 'date: 2026-01-02');
    assert.equal(lines[4], 'type: "essay"');
    assert.equal(lines[5], 'category: "Tech"');
    assert.deepEqual(lines.slice(6, 9), ['tags:', '  - alpha', '  - beta']);
    assert.equal(lines[9], 'author: "Your Name"');
    assert.equal(lines[10], 'featured: true');
    assert.equal(lines[11], 'draft: false');
    assert.equal(lines[12], '---');
  });

  it('writes an empty inline tags list when there are no tags', () => {
    assert.equal(serializeFrontmatter({ ...FULL, tags: [] }, 'x').includes('tags: []'), true);
  });

  it('omits updatedDate when absent and includes it when present', () => {
    assert.equal(serializeFrontmatter(FULL, 'x').includes('updatedDate'), false);
    assert.equal(
      serializeFrontmatter({ ...FULL, updatedDate: '2026-02-03' }, 'x').includes('updatedDate: 2026-02-03'),
      true,
    );
  });

  it('omits the featured key when false', () => {
    assert.equal(serializeFrontmatter({ ...FULL, featured: false }, 'x').includes('featured'), false);
  });

  it('trims surrounding blank lines from the body and ends with a newline', () => {
    const out = serializeFrontmatter(FULL, '\n\nBody line\n\n\n');
    assert.equal(out.endsWith('Body line\n'), true);
  });
});

describe('frontmatter round trip', () => {
  it('is stable across a parse/serialize cycle', () => {
    const once = serializeFrontmatter(FULL, 'Body line\n');
    const { data, body } = parseFrontmatter(once);
    const twice = serializeFrontmatter(dataToFrontmatter(data), body);
    assert.equal(twice, once);
  });

  it('preserves tags and booleans through the cycle', () => {
    const once = serializeFrontmatter({ ...FULL, draft: true, featured: false }, 'Body');
    const { data } = parseFrontmatter(once);
    const roundTripped = dataToFrontmatter(data);
    assert.deepEqual(roundTripped.tags, FULL.tags);
    assert.equal(roundTripped.draft, true);
    assert.equal(roundTripped.featured, false);
  });

  it('preserves crawl and copyProtect so a CMS save cannot silently reset them', () => {
    const once = serializeFrontmatter({ ...FULL, crawl: 'blocked', copyProtect: true }, 'Body');
    assert.match(once, /^crawl: blocked$/m);
    assert.match(once, /^copyProtect: true$/m);
    const roundTripped = dataToFrontmatter(parseFrontmatter(once).data);
    assert.equal(roundTripped.crawl, 'blocked');
    assert.equal(roundTripped.copyProtect, true);
    assert.match(serializeFrontmatter(roundTripped, 'Body'), /^copyProtect: true$/m);
  });

  it('drops an unknown crawl tier instead of writing it back', () => {
    const roundTripped = dataToFrontmatter({ ...FULL, crawl: 'private' });
    assert.equal(roundTripped.crawl, undefined);
  });
});

describe('serializeContentFrontmatter', () => {
  it('writes the optional policy fields for wiki collections', () => {
    const out = serializeContentFrontmatter(
      'world',
      { title: 'x', type: '概念', description: 'd', crawl: 'paid', copyProtect: false },
      'body',
    );
    assert.match(out, /^crawl: "paid"$/m);
    assert.match(out, /^copyProtect: false$/m);
  });
});

describe('dataToFrontmatter', () => {
  it('applies overrides on top of parsed data', () => {
    const result = dataToFrontmatter(
      { title: 't', description: 'd', date: '2026-01-01', tags: ['a'] },
      { tags: ['b'] },
    );
    assert.equal(result.title, 't');
    assert.equal(result.date, '2026-01-01');
    assert.equal(result.type, 'essay');
    assert.equal(result.author, 'Your Name');
    assert.equal(result.category, 'General');
    assert.deepEqual(result.tags, ['b']);
  });

  it('still reads the legacy pubDate key written before the rename', () => {
    const result = dataToFrontmatter({ title: 't', description: 'd', pubDate: '2025-12-31' });
    assert.equal(result.date, '2025-12-31');
  });
});

describe('isValidSlug', () => {
  it('accepts lowercase alphanumeric hyphenated slugs', () => {
    for (const slug of ['a', 'a-b', 'post-1-title']) {
      assert.equal(isValidSlug(slug), true, `should accept "${slug}"`);
    }
  });

  it('rejects uppercase, underscores, doubled or edge hyphens and empty input', () => {
    for (const slug of ['A-b', 'a_b', 'a--b', '-a', 'a-', '']) {
      assert.equal(isValidSlug(slug), false, `should reject "${slug}"`);
    }
  });

  it('rejects slugs longer than 200 characters', () => {
    assert.equal(isValidSlug('a'.repeat(200)), true);
    assert.equal(isValidSlug(`a-${'b'.repeat(199)}`), false);
  });
});
