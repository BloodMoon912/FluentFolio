// Copy guard for long-form content marked with [data-copy-protect].
//
// Loaded once from BaseLayout as a module and ignored by Swup's script reload,
// so the document-level listeners survive every navigation. When a copy/cut
// intersects a protected container it writes a bounded excerpt plus a source
// line to the clipboard instead of the full selection. Selection outside the
// container (search box, admin fields, code-copy buttons, blog posts) is never
// touched. This raises the bar for casual copying; it is not a lock.

import { COPY_MAX_CHARS, buildCopyText } from './copy-guard-core.js';

const PROTECTED = '[data-copy-protect]';
const ALLOWED = '[data-copy-allow], input, textarea, [contenteditable="true"]';

/**
 * @param {Node | null} node
 * @returns {Element | null}
 */
function elementOf(node) {
  return node instanceof Element ? node : (node?.parentElement ?? null);
}

/**
 * @param {Node | null} node
 * @returns {boolean}
 */
function insideAllowed(node) {
  const element = elementOf(node);
  return Boolean(element?.closest(ALLOWED));
}

/**
 * @param {Node | null} node
 * @returns {Element | null}
 */
function protectedRootFor(node) {
  const element = elementOf(node);
  if (!element || element.closest(ALLOWED)) return null;
  return element.closest(PROTECTED);
}

/**
 * @param {Range} range
 * @returns {Element | null}
 */
function rangeTouchesProtected(range) {
  for (const element of document.querySelectorAll(PROTECTED)) {
    try {
      if (range.intersectsNode(element)) return element;
    } catch {
      // Detached nodes throw; they cannot be part of a live selection.
    }
  }
  return null;
}

/**
 * The attribution line comes from the Site layer via data attributes on the
 * protected container; the guard itself ships no personal string.
 *
 * @param {Element} root
 * @returns {string | undefined}
 */
function licenseForLanguage(root) {
  const english = (document.documentElement.lang || '').toLowerCase().startsWith('en');
  const configured = root.getAttribute(english ? 'data-copy-license-en' : 'data-copy-license-zh');
  if (configured) return configured;
  return english ? '© Your Name. All rights reserved. Please credit the source when quoting.' : undefined;
}

/**
 * @param {ClipboardEvent} event
 * @returns {void}
 */
function replaceSelection(event) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  // A selection wholly inside [data-copy-allow] (or a form control) is left alone.
  if (insideAllowed(selection.anchorNode) && insideAllowed(selection.focusNode)) return;

  const range = selection.getRangeAt(0);
  const root = rangeTouchesProtected(range) ?? protectedRootFor(range.commonAncestorContainer);
  if (!root) return;

  const configured = Number.parseInt(root.getAttribute('data-copy-max') || '', 10);
  const maxChars = Number.isFinite(configured) ? configured : COPY_MAX_CHARS;
  const text = buildCopyText({
    selection: selection.toString(),
    title: document.title,
    url: window.location.href,
    license: licenseForLanguage(root),
    maxChars,
  });

  if (!text) return;
  event.clipboardData?.setData('text/plain', text);
  event.preventDefault();
}

if (!window.__bmCopyGuardInstalled) {
  window.__bmCopyGuardInstalled = true;

  document.addEventListener(
    'contextmenu',
    (event) => {
      if (protectedRootFor(/** @type {Node | null} */ (event.target))) event.preventDefault();
    },
    true,
  );

  document.addEventListener(
    'dragstart',
    (event) => {
      if (protectedRootFor(/** @type {Node | null} */ (event.target))) event.preventDefault();
    },
    true,
  );

  document.addEventListener('copy', replaceSelection);
  document.addEventListener('cut', (event) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    if (rangeTouchesProtected(selection.getRangeAt(0))) event.preventDefault();
  });
}
