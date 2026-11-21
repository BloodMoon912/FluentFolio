import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { markdownToHtml } from 'satteri';
import { createLoreLinksPlugin } from '../src/lib/lore-plugin.mjs';
import { LORE_SPAN_ATTRIBUTES, markdownSanitize } from '../src/lib/markdown-sanitize.mjs';

// Renders the committed attack fixture through the exact same processor
// plugins as astro.config.mjs. The dictionary is injected so the test never
// depends on src/content state.

const fixture = readFileSync(new URL('./fixtures/security/markdown-xss.md', import.meta.url), 'utf8');

const definitions = new Map([['test-word', '測試釋義。']]);
const lore = createLoreLinksPlugin(() => definitions);

async function render(source: string): Promise<string> {
  const result = await markdownToHtml(source, {
    mdastPlugins: [lore],
    hastPlugins: [markdownSanitize],
  });
  return result.html;
}

const html = await render(fixture);

describe('markdown sanitizer', () => {
  it('removes script elements and their text', () => {
    assert.equal(html.includes('<script'), false);
    assert.equal(html.includes("alert('xss')"), false);
    assert.equal(html.includes('evil.example/x.js'), false);
  });

  it('removes javascript: URLs from links and images', () => {
    assert.equal(html.includes('javascript:'), false);
    assert.equal(html.includes('alert(1)'), false);
    assert.match(html, /<a>bad javascript link<\/a>/);
  });

  it('strips event handlers, style and iframes', () => {
    assert.equal(html.includes('onerror='), false);
    assert.equal(html.includes('onload='), false);
    assert.equal(html.includes('onclick='), false);
    assert.equal(html.includes('style='), false);
    assert.equal(html.includes('<iframe'), false);
  });

  it('keeps safe Markdown links, emphasis and escaped code blocks', () => {
    assert.match(html, /<a href="https:\/\/example\.com">safe link<\/a>/);
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /&lt;script&gt;alert\('not executed'\)&lt;\/script&gt;/);
    assert.equal(html.includes("<script>alert('not executed')</script>"), false);
  });

  it('preserves the lore span and its tooltip attributes', () => {
    assert.match(html, /<span[^>]*class="lore-word"[^>]*data-lore-word="test-word"[^>]*data-tooltip="測試釋義。"/);
    assert.match(
      html,
      /<span[^>]*class="lore-word"[^>]*data-lore-word="not-in-the-dictionary"[^>]*data-lore-missing=""/,
    );
    // The popover contract also needs the span focusable.
    assert.match(html, /<span[^>]*data-lore-word="test-word"[^>]*tabindex="0"/);
  });

  it('does not need any extra span attributes beyond the documented allowlist', () => {
    assert.deepEqual(LORE_SPAN_ATTRIBUTES, [
      'className',
      'data-lore-word',
      'data-tooltip',
      'data-lore-missing',
      'tabindex',
    ]);
  });
});
