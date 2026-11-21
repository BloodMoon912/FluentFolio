import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getWordCount } from '../src/lib/word-count.ts';

describe('getWordCount', () => {
  describe('scripts', () => {
    it('counts one word per Chinese character', () => {
      assert.equal(getWordCount('你的名字'), 4);
    });

    it('ignores Chinese punctuation', () => {
      assert.equal(getWordCount('血月，高懸。\n夜色'), 6);
    });

    it('counts whitespace-separated English words', () => {
      assert.equal(getWordCount('Hello beautiful world'), 3);
    });

    it('treats underscores and hyphens as part of one token', () => {
      assert.equal(getWordCount('snake_case and kebab-case'), 3);
    });

    it('adds Chinese characters and Latin tokens together', () => {
      assert.equal(getWordCount('Hello 世界 2026'), 4);
      assert.equal(getWordCount('Chapter 12 章'), 3);
    });
  });

  describe('frontmatter', () => {
    it('skips a leading YAML block', () => {
      const markdown = '---\ntitle: 你的名字\ndate: 2026-01-01\n---\n正文';
      assert.equal(getWordCount(markdown), 2);
    });

    it('handles CRLF line endings', () => {
      assert.equal(getWordCount('---\r\ntitle: 測試\r\n---\r\n正文'), 2);
    });

    it('leaves a document without frontmatter alone', () => {
      assert.equal(getWordCount('正文'), 2);
    });
  });

  describe('HTML', () => {
    it('removes tags but keeps their text content', () => {
      assert.equal(getWordCount('<p class="lead">前<span>中</span>後</p>'), 3);
    });

    it('drops comments together with the text inside them', () => {
      assert.equal(getWordCount('<p>Hello</p><!-- 隱藏 註釋 -->世界'), 3);
      assert.equal(getWordCount('<!-- 註釋 -->'), 0);
    });
  });

  describe('code', () => {
    const fenced = '前文\n\n```js\nconst answer = 42;\n```\n\n後記';

    it('excludes fenced code blocks by default', () => {
      assert.equal(getWordCount(fenced), 4);
    });

    it('includes fenced code contents and their info string never counts', () => {
      assert.equal(getWordCount(fenced, { includeCode: true }), 7);
    });

    it('recognises tilde fences', () => {
      const markdown = '~~~txt\nhidden words\n~~~\n結尾';
      assert.equal(getWordCount(markdown), 2);
      assert.equal(getWordCount(markdown, { includeCode: true }), 4);
    });

    it('excludes inline code by default', () => {
      assert.equal(getWordCount('用 `npm test` 驗證'), 3);
    });

    it('includes inline code when asked', () => {
      assert.equal(getWordCount('用 `npm test` 驗證', { includeInlineCode: true }), 5);
    });
  });

  describe('links', () => {
    it('keeps link text and drops the destination', () => {
      assert.equal(getWordCount('見 [你的名字](https://example.com/a?b=1) 一文'), 7);
    });

    it('handles reference links and their definitions', () => {
      assert.equal(getWordCount('引用 [文檔][ref]\n\n[ref]: https://example.com/doc'), 4);
    });

    it('drops bare URLs', () => {
      assert.equal(getWordCount('訪問 https://example.com/path?q=1 獲取'), 4);
    });
  });

  describe('images', () => {
    it('keeps alt text by default', () => {
      assert.equal(getWordCount('![血月圖](https://example.com/moon.png)'), 3);
      assert.equal(getWordCount('![Blood Moon](x.png) 正文'), 4);
    });

    it('can drop alt text', () => {
      assert.equal(getWordCount('![血月圖](https://example.com/moon.png)', { includeImageAlt: false }), 0);
      assert.equal(getWordCount('![Blood Moon](x.png) 正文', { includeImageAlt: false }), 2);
    });
  });

  describe('structure', () => {
    it('drops heading hashes on both sides', () => {
      assert.equal(getWordCount('# 標題\n\n## 副題 ##'), 4);
    });

    it('drops list, task and blockquote markers', () => {
      assert.equal(getWordCount('> 引用\n\n- 列表項\n\n1. 有序項'), 8);
      assert.equal(getWordCount('- [x] 完成'), 2);
    });

    it('drops table pipes and delimiter rows, keeping cells', () => {
      const markdown = '| 名稱 | 數量 |\n| --- | ---: |\n| 蘋果 | 3 |';
      assert.equal(getWordCount(markdown), 7);
    });

    it('drops thematic breaks', () => {
      assert.equal(getWordCount('前\n\n---\n\n後'), 2);
    });
  });

  describe('edges', () => {
    it('returns zero for empty and whitespace-only input', () => {
      assert.equal(getWordCount(''), 0);
      assert.equal(getWordCount('   \n\t '), 0);
    });

    it('counts a realistic post body end to end', () => {
      const markdown = [
        '---',
        'title: 測試',
        '---',
        '',
        '# 標題',
        '',
        'Hello **世界**，這是 `code` 與 [連結](https://example.com)。',
        '',
        '```ts',
        'const x = 1;',
        '```',
      ].join('\n');

      // 標題 世界 這是 與 連結 = 9 characters, "Hello" = 1 token; the fence is excluded.
      assert.equal(getWordCount(markdown), 10);
    });
  });
});
