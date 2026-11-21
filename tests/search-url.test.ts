import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SEARCH_ROUTE_PREFIXES, safeInternalSearchUrl } from '../src/lib/search-url.ts';

const ORIGIN = 'https://www.example.com';

describe('safeInternalSearchUrl', () => {
  it('accepts the four content route prefixes on the same origin', () => {
    for (const prefix of SEARCH_ROUTE_PREFIXES) {
      assert.equal(safeInternalSearchUrl(`${prefix}example`, ORIGIN), `${prefix}example`);
    }
  });

  it('accepts absolute same-origin URLs and keeps query/hash', () => {
    assert.equal(
      safeInternalSearchUrl(`${ORIGIN}/dictionary/test-word?ref=search#top`, ORIGIN),
      '/dictionary/test-word?ref=search#top',
    );
  });

  it('rejects javascript:, data: and external / protocol-relative URLs', () => {
    assert.equal(safeInternalSearchUrl('javascript:alert(1)', ORIGIN), null);
    assert.equal(safeInternalSearchUrl('data:text/html,<script>alert(1)</script>', ORIGIN), null);
    assert.equal(safeInternalSearchUrl('https://evil.example/posts/blog/x', ORIGIN), null);
    assert.equal(safeInternalSearchUrl('//evil.example/posts/blog/x', ORIGIN), null);
  });

  it('rejects same-origin paths outside the content prefixes', () => {
    assert.equal(safeInternalSearchUrl('/admin', ORIGIN), null);
    assert.equal(safeInternalSearchUrl('/posts', ORIGIN), null);
    assert.equal(safeInternalSearchUrl('/posts/blog', ORIGIN), null);
    assert.equal(safeInternalSearchUrl('/', ORIGIN), null);
  });

  it('returns null for empty or malformed input', () => {
    assert.equal(safeInternalSearchUrl('', ORIGIN), null);
    assert.equal(safeInternalSearchUrl('http://[', ORIGIN), null);
  });
});
