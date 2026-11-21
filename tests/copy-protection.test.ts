import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COPY_MAX_CHARS, isCopyProtected } from '../src/lib/copy-protection.ts';

describe('COPY_MAX_CHARS', () => {
  it('is the documented 120-character limit', () => {
    assert.equal(COPY_MAX_CHARS, 120);
  });
});

describe('isCopyProtected', () => {
  it('protects fiction, dictionary and world entries by default', () => {
    assert.equal(isCopyProtected('novel'), true);
    assert.equal(isCopyProtected('dictionary'), true);
    assert.equal(isCopyProtected('world'), true);
  });

  it('leaves blog posts unprotected by default', () => {
    assert.equal(isCopyProtected('blog'), false);
  });

  it('lets the per-entry override win in both directions', () => {
    assert.equal(isCopyProtected('novel', false), false);
    assert.equal(isCopyProtected('blog', true), true);
  });
});
