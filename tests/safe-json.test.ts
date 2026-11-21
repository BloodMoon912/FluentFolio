import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { serializeForInlineScript } from '../src/lib/safe-json.ts';

describe('serializeForInlineScript', () => {
  it('escapes a closing script sequence', () => {
    const serialized = serializeForInlineScript({ t: '</script><script>alert(1)</script>' });
    assert.equal(serialized.includes('</script>'), false);
    assert.equal(serialized.includes('<'), false);
    assert.match(serialized, /\\u003c\/script\\u003e/);
    // Still valid JSON round-tripping to the original string.
    assert.deepEqual(JSON.parse(serialized), { t: '</script><script>alert(1)</script>' });
  });

  it('escapes <, > and & everywhere', () => {
    const serialized = serializeForInlineScript({ a: '<', b: '>', c: '&' });
    assert.equal(serialized.includes('<'), false);
    assert.equal(serialized.includes('>'), false);
    assert.equal(serialized.includes('&'), false);
    assert.deepEqual(JSON.parse(serialized), { a: '<', b: '>', c: '&' });
  });

  it('escapes JS line separators', () => {
    const serialized = serializeForInlineScript({ text: '\u2028\u2029' });
    assert.equal(serialized.includes('\u2028'), false);
    assert.equal(serialized.includes('\u2029'), false);
    assert.deepEqual(JSON.parse(serialized), { text: '\u2028\u2029' });
  });

  it('handles undefined and primitives', () => {
    assert.equal(serializeForInlineScript(undefined), 'null');
    assert.equal(serializeForInlineScript('a<b'), '"a\\u003cb"');
  });
});
