import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { escapeHtml } from '../src/lib/escape-html.ts';

describe('escapeHtml', () => {
  it('escapes every HTML-significant character', () => {
    assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  });

  it('neutralizes a script tag', () => {
    assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('neutralizes a double-quoted attribute break-out', () => {
    assert.equal(escapeHtml('" onmouseover="alert(1)'), '&quot; onmouseover=&quot;alert(1)');
  });

  it('neutralizes a single-quoted attribute break-out', () => {
    assert.equal(escapeHtml("' onmouseover='alert(1)"), '&#39; onmouseover=&#39;alert(1)');
  });

  it('leaves ordinary text untouched', () => {
    assert.equal(escapeHtml('Your Name — 關於你的名字'), 'Your Name — 關於你的名字');
  });

  it('accepts non-string values, including null and undefined', () => {
    assert.equal(escapeHtml(42), '42');
    assert.equal(escapeHtml(null), 'null');
    assert.equal(escapeHtml(undefined), 'undefined');
  });

  it('escapes the ampersand exactly once per pass', () => {
    assert.equal(escapeHtml('&amp;'), '&amp;amp;');
  });
});
