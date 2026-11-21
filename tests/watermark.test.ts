import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { markdownToHtml } from 'satteri';
import { createWatermarkPlugin } from '../src/lib/watermark-plugin.mjs';
import {
  SIGNATURE_BITS,
  ZERO_WIDTH_ONE,
  ZERO_WIDTH_ZERO,
  decodeRuns,
  encodeSignature,
  extractZeroWidthRuns,
  findMatches,
  signatureKey,
} from '../src/lib/watermark-core.mjs';

const SECRET = 'test-secret';

describe('encodeSignature', () => {
  it('emits exactly 32 zero-width characters, all from the two-symbol alphabet', () => {
    const signature = encodeSignature(SECRET, 'novel/chapter-1');
    assert.equal(signature.length, SIGNATURE_BITS);
    for (const char of signature) {
      assert.ok(char === ZERO_WIDTH_ZERO || char === ZERO_WIDTH_ONE, `unexpected ${char.codePointAt(0)}`);
    }
  });

  it('is deterministic for the same entry and secret', () => {
    assert.equal(encodeSignature(SECRET, 'novel/chapter-1'), encodeSignature(SECRET, 'novel/chapter-1'));
  });

  it('differs between entries and between secrets', () => {
    assert.notEqual(encodeSignature(SECRET, 'novel/chapter-1'), encodeSignature(SECRET, 'novel/chapter-2'));
    assert.notEqual(encodeSignature(SECRET, 'novel/chapter-1'), encodeSignature('other-secret', 'novel/chapter-1'));
  });
});

describe('decodeRuns', () => {
  it('decodes a full signature back to its bit string', () => {
    const signature = encodeSignature(SECRET, 'world/aether');
    const [chunk] = decodeRuns(signature);
    assert.equal(chunk.length, SIGNATURE_BITS);
    assert.match(chunk, /^[01]+$/);
  });

  it('ignores text without zero-width characters', () => {
    assert.deepEqual(extractZeroWidthRuns('plain 文字，沒有簽章。'), []);
    assert.deepEqual(decodeRuns('plain 文字，沒有簽章。'), []);
  });
});

describe('findMatches', () => {
  const keys = ['novel/chapter-1', 'novel/chapter-2', 'dictionary/aether', 'world/court'];

  it('matches a single copied paragraph that still carries its signature', () => {
    const paragraph = `第一章的段落。${encodeSignature(SECRET, 'novel/chapter-1')}`;
    assert.deepEqual(findMatches(SECRET, keys, paragraph), ['novel/chapter-1']);
  });

  it('returns every matching entry when several signatures are present', () => {
    const text =
      `第一段${encodeSignature(SECRET, 'novel/chapter-1')}` + `第二段${encodeSignature(SECRET, 'world/court')}`;
    assert.deepEqual(findMatches(SECRET, keys, text), ['novel/chapter-1', 'world/court']);
  });

  it('returns nothing for unmarked text or a wrong secret', () => {
    assert.deepEqual(findMatches(SECRET, keys, '未經複製的正文。'), []);
    assert.deepEqual(findMatches('wrong-secret', keys, encodeSignature(SECRET, 'novel/chapter-1')), []);
  });

  it('builds the documented collection/id key', () => {
    assert.equal(signatureKey('dictionary', 'aether'), 'dictionary/aether');
  });
});

describe('watermark plugin', () => {
  const fileURL = pathToFileURL('C:/project/src/content/novel/chapter-1.md');

  async function render(markdown: string, secret: string | null = SECRET): Promise<string> {
    const result = await markdownToHtml(markdown, {
      mdastPlugins: [createWatermarkPlugin({ secret: secret ?? undefined })],
      fileURL,
    });
    return result.html;
  }

  it('signs every long paragraph and leaves the visible text unchanged', async () => {
    const markdown = '第一段。\n\n第二段！\n\n第三段？\n\n第四段。\n';
    const html = await render(markdown);
    const visible = html.replace(/<[^>]+>/g, '').replace(/[\u200B\u200C]/g, '');
    assert.equal(visible, '第一段。\n第二段！\n第三段？\n第四段。\n');
    // One fixed 32-character signature per paragraph.
    assert.equal(extractZeroWidthRuns(html).length, 4);
    assert.deepEqual(findMatches(SECRET, ['novel/chapter-1'], html), ['novel/chapter-1']);
  });

  it('signs only once for a document shorter than three paragraphs', async () => {
    const html = await render('第一段沒有句號\n\n第二段也沒有\n');
    assert.equal(extractZeroWidthRuns(html).length, 1);
  });

  it('does not sign paragraphs outside the protected collections', async () => {
    const blogURL = pathToFileURL('C:/project/src/content/blog/essay.md');
    const result = await markdownToHtml('第一段。\n\n第二段。\n\n第三段。\n', {
      mdastPlugins: [createWatermarkPlugin({ secret: SECRET })],
      fileURL: blogURL,
    });
    assert.equal(extractZeroWidthRuns(result.html).length, 0);
  });

  it('skips cleanly when no secret is configured', async () => {
    const html = await render('第一段。\n\n第二段。\n\n第三段。\n', null);
    assert.equal(extractZeroWidthRuns(html).length, 0);
    assert.match(html, /第一段。/);
  });
});
