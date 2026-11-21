import { siteConfig } from '../src/site.config.ts';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  findUnsupportedCharacters,
  OG_PNG_HEIGHT,
  OG_PNG_WIDTH,
  renderOgPng,
  defaultOgCard,
} from '../src/lib/og-png.ts';
import { renderOgSvg } from '../src/lib/og.ts';

const CARD = {
  eyebrow: 'Tech',
  title: 'A post title',
  meta: siteConfig.authorName,
  brand: siteConfig.titleSuffix,
};

/** Reads the signature and IHDR dimensions of a PNG produced by resvg. */
function pngInfo(png: Uint8Array) {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG magic bytes');
  assert.equal(new TextDecoder().decode(png.subarray(12, 16)), 'IHDR', 'first chunk is IHDR');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe('renderOgSvg', () => {
  it('renders the documented 1200x630 viewBox', () => {
    const svg = renderOgSvg(CARD);
    assert.equal(svg.includes('width="1200"'), true);
    assert.equal(svg.includes('height="630"'), true);
    assert.match(svg, /^<svg /);
  });

  it('uppercases the eyebrow and renders every field', () => {
    const svg = renderOgSvg(CARD);
    assert.equal(svg.includes('TECH'), true);
    assert.equal(svg.includes('A post title'), true);
    assert.equal(svg.includes(siteConfig.authorName), true);
    assert.equal(svg.includes(siteConfig.titleSuffix), true);
  });

  it('escapes XML-significant characters in every field', () => {
    const svg = renderOgSvg({
      eyebrow: 'a<b',
      title: '<script>alert("x")</script>',
      meta: 'x & y',
      brand: "it's",
    });
    assert.equal(svg.includes('<script>'), false);
    assert.equal(svg.includes('&lt;script&gt;'), true);
    assert.equal(svg.includes('x &amp; y'), true);
    assert.equal(svg.includes('it&apos;s'), true);
  });

  it('wraps a long title into multiple tspans', () => {
    const svg = renderOgSvg({ ...CARD, title: 'word '.repeat(80).trim() });
    const tspans = svg.match(/<tspan /g) ?? [];
    assert.equal(tspans.length > 1, true);
  });

  it('truncates at three lines with an ellipsis', () => {
    const svg = renderOgSvg({ ...CARD, title: '\u4e2d\u6587'.repeat(200) });
    const tspans = svg.match(/<tspan /g) ?? [];
    assert.equal(tspans.length, 3);
    assert.equal(svg.includes('\u2026'), true);
  });

  it('omits the eyebrow element when the eyebrow is empty', () => {
    const svg = renderOgSvg({ ...CARD, eyebrow: '' });
    assert.equal(svg.includes('letter-spacing="5"'), false);
  });

  it('asks for the bundled font family first, so rasterising is deterministic', () => {
    assert.match(renderOgSvg(CARD), /font-family="'Noto Sans TC'/);
  });
});

describe('renderOgPng', () => {
  it('renders the card as a 1200x630 PNG', () => {
    const png = renderOgPng(CARD);
    assert.equal(png.length > 1000, true);
    assert.deepEqual(pngInfo(png), { width: 1200, height: 630 });
    assert.equal(OG_PNG_WIDTH, 1200);
    assert.equal(OG_PNG_HEIGHT, 630);
  });

  it('renders Chinese card text with the bundled font', () => {
    const png = renderOgPng({
      eyebrow: '\u96a8\u7b46\u65e5\u8a18',
      title: '\u95dc\u65bc\u6697\u591c\u8840\u6708\u7684\u500b\u4eba\u7a7a\u9593',
      meta: `${siteConfig.authorName} \u00b7 2026-09-14`,
      brand: siteConfig.titleSuffix,
    });
    assert.deepEqual(pngInfo(png), { width: 1200, height: 630 });
  });

  it('changes the pixels when the title changes', () => {
    const first = renderOgPng(CARD);
    const second = renderOgPng({ ...CARD, title: 'A different title' });
    assert.equal(Buffer.from(first).equals(Buffer.from(second)), false);
  });

  it('renders the site fallback card', () => {
    assert.deepEqual(pngInfo(renderOgPng(defaultOgCard())), { width: 1200, height: 630 });
  });
});

describe('subsetted OG font', () => {
  it('keeps both weights under the 2 MB budget', () => {
    const total =
      statSync(new URL('../src/assets/fonts/NotoSansTC-Regular.subset.ttf', import.meta.url)).size +
      statSync(new URL('../src/assets/fonts/NotoSansTC-Bold.subset.ttf', import.meta.url)).size;
    assert.equal(total < 2 * 1024 * 1024, true, `font subsets total ${total} bytes`);
  });

  it('covers every character the site currently renders on a card', () => {
    const text = [
      defaultOgCard().eyebrow,
      defaultOgCard().title,
      defaultOgCard().meta,
      defaultOgCard().brand,
      '\u96a8\u7b46\u65e5\u8a18', // essay category used by the only published post
      'Your Name \u00b7 2026-09-14',
    ].join('\n');
    assert.deepEqual(findUnsupportedCharacters(text), []);
  });

  it('reports characters the subset cannot render, so the warning is actionable', () => {
    assert.deepEqual(findUnsupportedCharacters('ok \u{1f642}'), ['\u{1f642}']);
  });
});
