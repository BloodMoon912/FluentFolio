// Click-to-zoom for article images. Progressive enhancement: without this
// script the images render and link exactly as before.
//
// A single native <dialog> is reused for every image, and one delegated click
// listener on `document` survives Swup replacing <main>. No external library and
// no inline script, so the CSP `script-src 'self'` policy still holds.
(function () {
  if (window.__bmImageLightboxBound) return;
  window.__bmImageLightboxBound = true;
  // The cursor affordance can appear before the first dialog is built.
  document.documentElement.classList.add('has-image-lightbox');

  var SELECTOR = '.markdown-content img';
  /** @type {HTMLDialogElement | null} */
  var dialog = null;
  /** @type {HTMLImageElement | null} */
  var preview = null;
  /** @type {Element | null} */
  var lastFocus = null;

  function lang() {
    return document.documentElement.dataset.lang === 'en' ? 'en' : 'zh';
  }

  /** @param {string} key @param {string} zh @param {string} en */
  function label(key, zh, en) {
    var translate = typeof window.T === 'function' ? window.T : null;
    if (translate) return translate(key);
    return lang() === 'en' ? en : zh;
  }

  function ensureDialog() {
    if (dialog) return dialog;

    dialog = document.createElement('dialog');
    dialog.className = 'image-lightbox';
    dialog.setAttribute('aria-label', label('image_lightbox', '放大圖片', 'Enlarged image'));

    preview = document.createElement('img');
    preview.className = 'image-lightbox__image';
    preview.alt = '';
    preview.decoding = 'async';

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'image-lightbox__close';
    close.setAttribute('aria-label', label('image_lightbox_close', '關閉放大圖片', 'Close enlarged image'));
    close.textContent = '\u00d7';

    dialog.appendChild(preview);
    dialog.appendChild(close);
    document.body.appendChild(dialog);

    close.addEventListener('click', closeDialog);
    // Clicking the backdrop (the dialog box itself, outside the image) closes.
    dialog.addEventListener('click', function (/** @type {MouseEvent} */ event) {
      if (event.target === dialog) closeDialog();
    });
    dialog.addEventListener('close', restoreFocus);

    return dialog;
  }

  function restoreFocus() {
    if (lastFocus instanceof HTMLElement) lastFocus.focus({ preventScroll: true });
    lastFocus = null;
  }

  function closeDialog() {
    if (dialog && dialog.open) dialog.close();
  }

  /** @param {HTMLImageElement} image */
  function openDialog(image) {
    // Images inside a link keep their normal link behaviour, and small
    // badges (licence marks, icons) have nothing worth enlarging.
    if (image.closest('a') || image.naturalWidth < 120) return;
    var overlay = ensureDialog();
    if (!overlay || !preview) return;

    lastFocus = document.activeElement;
    preview.src = image.currentSrc || image.src;
    preview.alt = image.alt || '';
    preview.width = image.naturalWidth || 0;
    preview.height = image.naturalHeight || 0;
    if (!overlay.open) overlay.showModal();
  }

  document.addEventListener('click', function (/** @type {MouseEvent} */ event) {
    var target = event.target;
    if (!(target instanceof Element)) return;
    var image = target.closest(SELECTOR);
    if (image instanceof HTMLImageElement) openDialog(image);
  });
})();
