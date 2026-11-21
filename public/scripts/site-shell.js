const win = window;
// This file is served verbatim from public/scripts/, so it cannot use
// TypeScript syntax — only JSDoc. `$$` narrows querySelectorAll from
// `Element`, which lacks dataset/style/media members, to `HTMLElement`.
/** @type {(selector: string) => NodeListOf<HTMLElement>} */
const $$ = (selector) => /** @type {any} */ (document.querySelectorAll(selector));
const dictEl = document.getElementById('i18n-dict');
const I18N = dictEl?.textContent ? JSON.parse(dictEl.textContent) : {};
const root = document.documentElement;
const SITE_SUFFIX = 'FluentFolio';

/** @type {'zh' | 'en'} */
let lang = 'zh';
try {
  lang = localStorage.getItem('bm-lang') === 'en' ? 'en' : 'zh';
} catch {
  // Storage blocked: the <head> script already fell back, so mirror it.
  lang = root.dataset.lang === 'en' ? 'en' : 'zh';
}
const setHtmlLang = () => {
  document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
  document.documentElement.dataset.lang = lang;
};

/** @type {(key: string, ...args: unknown[]) => string} */
const translate = (key, ...args) => {
  const entry = I18N[lang]?.[key] ?? I18N.zh?.[key] ?? key;
  return String(entry).replace(/\{(\d+)\}/g, (_match, i) => String(args[Number(i)] ?? ''));
};
win.T = translate;
win.getLang = () => lang;

function applyLang() {
  setHtmlLang();
  $$('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (!key) return;
    const args = (el.dataset.i18nArgs || '').split('|').filter((value) => value !== '');
    el.textContent = win.T?.(key, ...args) ?? key;
  });
  $$('[data-i18n-title]').forEach((el) => {
    const key = el.dataset.i18nTitle;
    if (!key) return;
    const value = win.T?.(key) ?? key;
    el.title = value;
    el.setAttribute('aria-label', value);
  });
  $$('[data-i18n-alt]').forEach((el) => {
    const key = el.dataset.i18nAlt;
    if (key) /** @type {HTMLImageElement} */ (el).alt = win.T?.(key) ?? key;
  });
  $$('[data-i18n-aria]').forEach((el) => {
    const key = el.dataset.i18nAria;
    if (key) el.setAttribute('aria-label', win.T?.(key) ?? key);
  });
  $$('[data-i18n-ph]').forEach((el) => {
    const key = el.dataset.i18nPh;
    if (key) /** @type {HTMLInputElement} */ (el).placeholder = win.T?.(key) ?? key;
  });
  $$('#lang, #lang-m').forEach((button) => {
    button.setAttribute('aria-label', lang === 'zh' ? 'Switch language · English' : '切換語言 · 中文');
  });
  const titleEl = /** @type {HTMLTitleElement | null} */ (document.querySelector('title[data-title-key]'));
  const titleKey = titleEl?.dataset.titleKey ?? '';
  // A page can opt out of the " · FluentFolio" suffix (the homepage has its own
  // complete title). The server renders the same flag into
  // `data-title-suffix`, so the language toggle cannot re-add it.
  const titleSuffix = titleEl?.dataset.titleSuffix !== 'false';
  if (titleEl)
    document.title = titleKey
      ? titleSuffix
        ? `${win.T?.(titleKey) ?? titleKey} · ${SITE_SUFFIX}`
        : (win.T?.(titleKey) ?? titleKey)
      : (titleEl.textContent ?? '');
  window.dispatchEvent(new CustomEvent('bm:lang', { detail: { lang } }));
  requestAnimationFrame(() => window.dispatchEvent(new Event('bm:nav-layout')));
}

/** @type {(next: string) => void} */
const setLang = (next) => {
  if (next !== 'zh' && next !== 'en') return;
  lang = next;
  try {
    localStorage.setItem('bm-lang', lang);
  } catch {
    // Preference not persisted (storage blocked); this tab still works.
  }
  applyLang();
};
win.setLang = setLang;
document.querySelectorAll('#lang, #lang-m').forEach((button) => {
  button.addEventListener('click', () => win.setLang?.(lang === 'zh' ? 'en' : 'zh'));
});
applyLang();

const navToggle = document.getElementById('nav-toggle');
const mobileMenu = document.getElementById('mobile-menu');
const closeMenu = () => {
  mobileMenu?.classList.remove('open');
  navToggle?.classList.remove('open');
  navToggle?.setAttribute('aria-expanded', 'false');
};
navToggle?.addEventListener('click', () => {
  const open = mobileMenu?.classList.toggle('open') ?? false;
  navToggle.classList.toggle('open', open);
  navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
});
mobileMenu?.querySelectorAll('a').forEach((anchor) => anchor.addEventListener('click', closeMenu));

const desktopNav = /** @type {HTMLElement | null} */ (document.querySelector('.topbar-left nav'));
const navIndicator = /** @type {HTMLElement | null} */ (desktopNav?.querySelector('.nav-selection-indicator'));
let navIndicatorFrame = 0;
const positionNavIndicator = () => {
  if (!desktopNav || !navIndicator || window.matchMedia("(max-width: 1000px)").matches) {
    if (navIndicator) navIndicator.style.opacity = '0';
    return;
  }
  const active = desktopNav.querySelector('a.active');
  if (!active) {
    navIndicator.style.opacity = '0';
    return;
  }
  const navRect = desktopNav.getBoundingClientRect();
  const linkRect = active.getBoundingClientRect();
  navIndicator.style.left = `${linkRect.left - navRect.left}px`;
  navIndicator.style.top = `${linkRect.top - navRect.top + linkRect.height / 2}px`;
  navIndicator.style.width = `${linkRect.width}px`;
  navIndicator.style.opacity = '1';
};
const scheduleNavIndicator = () => {
  cancelAnimationFrame(navIndicatorFrame);
  navIndicatorFrame = requestAnimationFrame(positionNavIndicator);
};
window.addEventListener('bm:nav-layout', scheduleNavIndicator);
window.addEventListener('bm:lang', scheduleNavIndicator);
desktopNav?.querySelectorAll('a').forEach((anchor) => {
  anchor.addEventListener('click', () => {
    desktopNav.querySelectorAll('a').forEach((item) => {
      item.classList.remove('active');
      item.removeAttribute('aria-current');
    });
    anchor.classList.add('active');
    anchor.setAttribute('aria-current', 'page');
    scheduleNavIndicator();
  });
});
window.addEventListener('resize', scheduleNavIndicator);
window.addEventListener('load', scheduleNavIndicator, { once: true });
scheduleNavIndicator();

const themeButtons = $$('#theme, #theme-m');
/** @type {(theme: string) => void} */
const syncThemeColor = (theme) => {
  const meta = /** @type {HTMLMetaElement | null} */ (document.querySelector('meta[name="theme-color"]'));
  if (meta) meta.content = theme === 'light' ? '#f4f5f7' : '#0d0f13';
};
/** @type {(theme: string) => void} */
const setIcon = (theme) => {
  // #22: vendored icons, served from this site (scripts/vendor-fluent-icons.mjs).
  const icon =
    theme === 'light' ? '/icons/fluent/lightbulb_filament_24_regular.svg' : '/icons/fluent/dark_theme_24_regular.svg';
  themeButtons.forEach((button) => {
    const target = /** @type {HTMLElement | null} */ (button.querySelector('.fluent-icon'));
    if (target) target.style.setProperty('--fluent-icon-url', `url("${icon}")`);
  });
};
/** @type {(theme: string) => void} */
const applyTheme = (theme) => {
  const next = theme === 'light' ? 'light' : 'dark';
  root.dataset.theme = next;
  setIcon(next);
  syncThemeColor(next);
};
// #19: the <head> script already chose and applied the theme before first
// paint. This only mirrors the current value into the theme icon and the
// theme-color meta tag; the toggle below goes through the same path, so
// there is exactly one initialisation point.
applyTheme(root.dataset.theme === 'light' ? 'light' : 'dark');
themeButtons.forEach((button) =>
  button.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      // Preference not persisted (storage blocked); this tab still works.
    }
  }),
);

const easterAudio = /** @type {HTMLAudioElement | null} */ (document.getElementById('easter-audio'));
const onlineChips = $$('.online-chip');
let clickCount = 0;
/** @type {ReturnType<typeof setTimeout> | null} */
let clickTimer = null;
onlineChips.forEach((chip) =>
  chip.addEventListener('click', () => {
    clickCount += 1;
    if (clickTimer !== null) clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      clickCount = 0;
    }, 2000);
    if (clickCount >= 5) {
      clickCount = 0;
      clickTimer = null;
      if (easterAudio) {
        easterAudio.currentTime = 0;
        void easterAudio.play().catch(() => undefined);
      }
    }
  }),
);

const bgImg = /** @type {HTMLImageElement | null} */ (document.getElementById('site-bg-img'));
const bgVideo = /** @type {HTMLVideoElement | null} */ (document.getElementById('site-bg-video'));
const bgToggle = /** @type {HTMLButtonElement | null} */ (document.getElementById('bg-toggle'));
if (bgImg) {
  bgImg.addEventListener('error', () => bgImg.remove());
  bgVideo?.addEventListener('playing', () => bgImg.remove());
}

// #20: the animated background is optional. It is never requested for
// `prefers-reduced-motion: reduce` (the static WebP stays), nor for Data
// Saver / slow connections (the video is a multi-MB download), nor on
// narrow viewports where the static image is the intended presentation.
// The footer button pauses/resumes it, remembers the choice and exposes
// the state through aria-pressed. Every localStorage access is guarded:
// some privacy modes throw on read as well as on write.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
/** @type {() => boolean} */
const canPlayBgVideo = () => {
  if (reducedMotion.matches) return false;
  // `connection` is non-standard and inconsistently named across engines,
  // so the Navigator type does not carry it.
  const nav = /** @type {any} */ (navigator);
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
  if (conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ''))) return false;
  return window.matchMedia('(min-width: 900px)').matches;
};
/** @type {() => boolean} */
const readBgPreference = () => {
  try {
    return localStorage.getItem('bm-bg-video') !== 'off';
  } catch {
    return true;
  }
};
/** @type {(enabled: boolean) => void} */
const rememberBgPreference = (enabled) => {
  try {
    localStorage.setItem('bm-bg-video', enabled ? 'on' : 'off');
  } catch {
    // Preference not persisted; playback still works for this page view.
  }
};
/** @type {(playing: boolean) => void} */
const setBgToggleState = (playing) => {
  if (!bgToggle) return;
  bgToggle.hidden = false;
  bgToggle.setAttribute('aria-pressed', playing ? 'true' : 'false');
};
let bgVideoRequested = false;
/** @type {(play: boolean) => void} */
const setBgVideo = (play) => {
  if (!bgVideo) return;
  if (!play) {
    bgVideo.pause();
    setBgToggleState(false);
    rememberBgPreference(false);
    return;
  }
  if (!bgVideoRequested) {
    const sources = /** @type {NodeListOf<HTMLSourceElement> | undefined} */ (
      bgVideo.querySelectorAll('source[data-src]')
    );
    if (!sources?.length) return;
    sources.forEach((source) => {
      const src = source.dataset.src;
      // Guarded so a missing data-src can never become src="undefined".
      if (src) source.src = src;
    });
    bgVideo.load();
    bgVideoRequested = true;
  }
  bgVideo.play().catch(() => undefined);
  setBgToggleState(true);
  rememberBgPreference(true);
};

if (!canPlayBgVideo()) {
  // Nothing to toggle: keep the button out of the tab order and never
  // request the video file.
  if (bgToggle) bgToggle.hidden = true;
} else if (bgToggle) {
  bgToggle.hidden = false;
  bgToggle.setAttribute('aria-pressed', 'false');
  bgToggle.addEventListener('click', () => {
    const playing = !!bgVideo && !bgVideo.paused && bgVideo.readyState > 2;
    setBgVideo(!playing);
  });
}

const startBgVideo = () => {
  if (!bgVideo || !canPlayBgVideo() || !readBgPreference()) return;
  setBgVideo(true);
};
// Wait for the window 'load' event so the video never competes with the
// page's own critical resources.
if (document.readyState === 'complete') {
  startBgVideo();
} else {
  window.addEventListener('load', startBgVideo, { once: true });
}

// The /posts tab controller lives in the persistent shell rather than
// inside the page fragment. Swup replaces <main>, so a page-local inline
// script is not a reliable place to own delegated click/history handlers.
/** @returns {HTMLElement | null} */
const getContentTabs = () => /** @type {HTMLElement | null} */ (document.querySelector('.content-tabs'));
/** @param {HTMLAnchorElement} link @returns {'blog' | 'novel'} */
const getContentTabName = (link) =>
  new URL(link.href, location.href).searchParams.get('tab') === 'novel' ? 'novel' : 'blog';
/** @returns {'blog' | 'novel'} */
const readContentTab = () => (new URL(location.href).searchParams.get('tab') === 'novel' ? 'novel' : 'blog');
/** @param {'blog' | 'novel'} name */
const writeContentTabUrl = (name) => {
  const url = new URL(location.href);
  url.searchParams.set('tab', name);
  if (url.href === location.href) return;
  // Keep Swup's history metadata so back/forward can restore the server-
  // rendered panel instead of leaving the URL and visible panel out of sync.
  const state = Object.assign({}, history.state || {}, {
    url: url.pathname + url.search,
    source: 'swup',
    tab: name,
  });
  history.pushState(state, '', url.href);
};
let contentTabPillFrame = 0;
/** @param {HTMLElement} tabs @param {HTMLElement} target @param {boolean} animate */
const moveContentTabPill = (tabs, target, animate) => {
  const pill = /** @type {HTMLElement | null} */ (tabs.querySelector('.content-tabs__pill'));
  if (!pill) return;
  const tabsRect = tabs.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const left = targetRect.left - tabsRect.left;
  const width = targetRect.width;

  // Suppress the initial off-screen 0px -> target movement. Once placed,
  // subsequent changes use the Fluent transition defined in shell.css.
  cancelAnimationFrame(contentTabPillFrame);
  if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    pill.style.transition = 'none';
    pill.style.left = `${left}px`;
    pill.style.width = `${width}px`;
    void pill.offsetWidth;
    pill.style.transition = '';
  } else {
    // A frame boundary ensures the browser has committed the previous
    // geometry before the new left/width values are applied.
    contentTabPillFrame = requestAnimationFrame(() => {
      pill.style.left = `${left}px`;
      pill.style.width = `${width}px`;
    });
  }
  tabs.classList.add('is-ready');
};
/** @param {'blog' | 'novel'} name @param {boolean} animate @param {boolean} [syncSearch] */
const activateContentTab = (name, animate, syncSearch = false) => {
  const tabs = getContentTabs();
  if (!tabs) return;
  const links = /** @type {NodeListOf<HTMLAnchorElement>} */ (tabs.querySelectorAll('.content-tab'));
  /** @type {HTMLAnchorElement | null} */
  let activeLink = null;
  links.forEach((link) => {
    const active = getContentTabName(link) === name;
    link.setAttribute('aria-selected', active ? 'true' : 'false');
    if (active) activeLink = link;
  });
  const blogPanel = document.getElementById('panel-blog');
  const novelPanel = document.getElementById('panel-novel');
  if (blogPanel) blogPanel.hidden = name !== 'blog';
  if (novelPanel) novelPanel.hidden = name !== 'novel';
  if (activeLink) moveContentTabPill(tabs, activeLink, animate);
  if (syncSearch) {
    document.dispatchEvent(new CustomEvent('bm:inline-search-sync', { detail: { tab: name } }));
  }
};

document.addEventListener(
  'click',
  (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = /** @type {HTMLAnchorElement | null} */ (target.closest('.content-tab'));
    if (!link || !getContentTabs()) return;
    event.preventDefault();
    event.stopPropagation();
    const name = getContentTabName(link);
    writeContentTabUrl(name);
    activateContentTab(name, true, true);
  },
  true,
);

document.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
  const target = event.target;
  if (!(target instanceof Element) || !target.closest('.content-tab')) return;
  const tabs = getContentTabs();
  if (!tabs) return;
  const links = /** @type {NodeListOf<HTMLAnchorElement>} */ (tabs.querySelectorAll('.content-tab'));
  if (!links.length) return;
  const active = tabs.querySelector('.content-tab[aria-selected="true"]');
  const current = active instanceof HTMLAnchorElement ? getContentTabName(active) : 'blog';
  const index = current === 'novel' ? 1 : 0;
  const next = links[(index + (event.key === 'ArrowRight' ? 1 : -1) + links.length) % links.length];
  if (!next) return;
  event.preventDefault();
  next.click();
  next.focus();
});

window.addEventListener('popstate', () => activateContentTab(readContentTab(), false, true));
window.addEventListener('resize', () => activateContentTab(readContentTab(), false));
window.addEventListener('bm:lang', () => activateContentTab(readContentTab(), false));
const syncContentTabsAfterNavigation = () => {
  requestAnimationFrame(() => activateContentTab(readContentTab(), false, true));
};
document.addEventListener('swup:content:replace', syncContentTabsAfterNavigation);
document.addEventListener('swup:page:view', syncContentTabsAfterNavigation);
// The initial HTML is already present when this persistent script runs.
activateContentTab(readContentTab(), false);

// Astro/swup only swaps the contents of <main> on page transitions; the
// freshly-fetched HTML is always server-rendered in zh, so without this
// the page would silently fall back to Chinese after every in-app
// navigation even while the site is set to English.
document.addEventListener('swup:content:replace', () => {
  applyLang();
});

document.addEventListener('swup:page:view', () => {
  const path = location.pathname;
  /** @type {(href: string | null) => boolean} */
  const isActive = (href) => {
    if (!href) return false;
    try {
      const u = new URL(href, location.origin);
      if (u.pathname === '/') return path === '/';
      return path === u.pathname || path.startsWith(`${u.pathname}/`);
    } catch {
      return false;
    }
  };
  // Only the two site nav lists. A bare `nav a` also matched the TOC, the
  // chapter dock and the /posts tabs, and rewrote their state on every visit.
  document.querySelectorAll('.topbar-left nav a, .mobile-menu > a').forEach((anchor) => {
    const active = isActive(anchor.getAttribute('href'));
    anchor.classList.toggle('active', active);
    if (active) anchor.setAttribute('aria-current', 'page');
    else anchor.removeAttribute('aria-current');
  });

  // Global search intentionally remains visible on every route, even
  // when the current page also provides a collection-specific inline filter.
  scheduleNavIndicator();
});
