// Progressive enhancements for published Markdown: responsive table wrappers
// and one-click code copying.
//
// Loaded once from BaseLayout. Swup re-runs body scripts that are not opted out
// (`reloadScripts` in the @swup/astro config), so the listeners below are bound
// behind a guard: re-evaluating this file must not stack a second pair of swup
// listeners. Same pattern as `lore-tooltip.js`.
(function () {
  if (window.__bmMarkdownEnhanceBound) return;
  window.__bmMarkdownEnhanceBound = true;

  const FALLBACK = {
    copy: '複製',
    copied: '已複製',
    failed: '複製失敗',
    copyAria: '複製程式碼',
    tableScrollAria: '可橫向捲動的表格',
  };

  /** @type {(key: string, fallback: string) => string} */
  const translate = (key, fallback) => {
    const dict = window.T;
    if (typeof dict !== 'function') return fallback;
    const value = dict(key);
    return value === key ? fallback : value;
  };

  /** @param {string} value */
  const copyText = async (value) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const field = document.createElement('textarea');
    field.value = value;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    if (!copied) throw new Error('Clipboard unavailable');
  };

  /** @param {ParentNode} root */
  const enhance = (root) => {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    /** @type {NodeListOf<HTMLElement>} */
    const blocks = root.querySelectorAll('.markdown-content pre');
    blocks.forEach((pre) => {
      if (pre.dataset.mdEnhanced === 'true') return;
      const code = pre.querySelector('code');
      if (!code) return;
      pre.dataset.mdEnhanced = 'true';

      const language =
        [...code.classList]
          .find((name) => name.startsWith('language-'))
          ?.slice('language-'.length)
          .replace(/[^a-zA-Z0-9_+#.-]/g, '') || 'text';
      const toolbar = document.createElement('div');
      toolbar.className = 'markdown-code-toolbar';
      const label = document.createElement('span');
      label.className = 'markdown-code-language';
      label.textContent = language.toUpperCase();
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'markdown-code-copy';
      /** Reset the button to its idle label in the current UI language. */
      const showIdle = () => {
        button.textContent = translate('code_copy', FALLBACK.copy);
        button.setAttribute('aria-label', translate('code_copy_aria', FALLBACK.copyAria));
      };
      showIdle();
      let resetTimer = 0;
      button.addEventListener('click', async () => {
        window.clearTimeout(resetTimer);
        try {
          await copyText(code.textContent || '');
          button.textContent = translate('code_copied', FALLBACK.copied);
        } catch {
          button.textContent = translate('code_copy_failed', FALLBACK.failed);
        }
        resetTimer = window.setTimeout(showIdle, 1600);
      });
      // Language switched while the button is idle: relabel it in place.
      button.__mdShowIdle = showIdle;
      toolbar.append(label, button);
      pre.insertBefore(toolbar, pre.firstChild);
    });

    /** @type {NodeListOf<HTMLElement>} */
    const tables = root.querySelectorAll('.markdown-content table');
    tables.forEach((table) => {
      if (table.parentElement && table.parentElement.classList.contains('markdown-table-wrap')) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'markdown-table-wrap';
      // A scroll container needs to be focusable for keyboard users; the label
      // comes from the i18n dictionary so screen readers announce it.
      wrapper.tabIndex = 0;
      wrapper.setAttribute('role', 'region');
      wrapper.setAttribute('aria-label', translate('table_scroll_aria', FALLBACK.tableScrollAria));
      table.replaceWith(wrapper);
      wrapper.appendChild(table);
    });
  };

  const run = () => enhance(document);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
  document.addEventListener('swup:content:replace', run);
  document.addEventListener('swup:page:view', run);

  document.addEventListener('bm:lang', () => {
    const dict = window.T;
    if (typeof dict !== 'function') return;
    document.querySelectorAll('.markdown-code-copy').forEach((button) => {
      if (typeof button.__mdShowIdle === 'function') button.__mdShowIdle();
    });
    document.querySelectorAll('.markdown-table-wrap').forEach((wrapper) => {
      wrapper.setAttribute('aria-label', translate('table_scroll_aria', FALLBACK.tableScrollAria));
    });
  });
})();
