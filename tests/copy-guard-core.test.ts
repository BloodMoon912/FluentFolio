import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COPY_MAX_CHARS, buildCopyText } from '../public/scripts/copy-guard-core.js';

const base = {
  title: '第一章',
  url: 'https://www.example.com/posts/novel/chapter-1',
  license: '© 你的名字 版權所有，轉載請註明出處',
};

describe('buildCopyText', () => {
  it('keeps short selections unchanged and appends one attribution line', () => {
    const text = buildCopyText({ ...base, selection: '只有一句。' });
    assert.equal(
      text,
      '只有一句。\n\n—— 摘自《第一章》 https://www.example.com/posts/novel/chapter-1 © 你的名字 版權所有，轉載請註明出處',
    );
  });

  it('truncates long selections to COPY_MAX_CHARS and marks the cut with an ellipsis', () => {
    const selection = '字'.repeat(COPY_MAX_CHARS + 50);
    const text = buildCopyText({ ...base, selection });
    const [excerpt] = text.split('\n\n');
    assert.equal(excerpt, `${'字'.repeat(COPY_MAX_CHARS)}…`);
  });

  it('keeps only the attribution when maxChars is 0', () => {
    const text = buildCopyText({ ...base, selection: '整段內文', maxChars: 0 });
    assert.equal(text.startsWith('—— 摘自'), true);
    assert.equal(text.includes('整段內文'), false);
  });

  it('preserves CJK and line breaks inside the excerpt', () => {
    const text = buildCopyText({ ...base, selection: '第一行。\r\n第二行。\n第三行。' });
    assert.equal(text.startsWith('第一行。\n第二行。\n第三行。\n\n—— 摘自'), true);
  });

  it('returns an empty string for an empty or whitespace-only selection', () => {
    assert.equal(buildCopyText({ ...base, selection: '' }), '');
    assert.equal(buildCopyText({ ...base, selection: '   \n\t ' }), '');
  });

  it('uses the supplied license and a fallback title', () => {
    const text = buildCopyText({
      selection: '引用。',
      title: '',
      url: 'https://example.com/x',
      license: 'All rights reserved.',
    });
    assert.equal(text, '引用。\n\n—— 摘自《未命名》 https://example.com/x All rights reserved.');
  });
});
