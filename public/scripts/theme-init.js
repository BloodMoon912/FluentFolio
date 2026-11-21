(function () {
  const root = document.documentElement;
  /** @type {string | null} */
  let theme = null;
  try {
    theme = localStorage.getItem('theme');
  } catch {
    // Storage can be blocked (private mode, enterprise policy); fall
    // back to the OS preference instead of failing the whole script.
  }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  root.dataset.theme = theme;
  const themeColor = /** @type {HTMLMetaElement | null} */ (document.querySelector('meta[name="theme-color"]'));
  if (themeColor) themeColor.content = theme === 'light' ? '#f4f5f7' : '#0d0f13';

  /** @type {'zh' | 'en'} */
  let lang = 'zh';
  try {
    lang = localStorage.getItem('bm-lang') === 'en' ? 'en' : 'zh';
  } catch {
    lang = 'zh';
  }
  root.lang = lang === 'zh' ? 'zh-Hant' : 'en';
  root.dataset.lang = lang;
})();
