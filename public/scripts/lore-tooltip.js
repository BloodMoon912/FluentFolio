// Hover / focus popover for lore words.
//
// Zero-API by design: each `[[word]]` is rendered at build time as
// <span class="lore-word" data-lore-word="…" data-tooltip="…" tabindex="0">,
// so this file never fetches anything. It reads the definition off the element
// and paints it in a glass popover. Editing a definition changes the chapter
// HTML at the next build, not a shared JSON endpoint.
//
// Progressive enhancement only: without this file the words are still readable
// text, and the same words are linked from /dictionary/.
//
// Loaded once from BaseLayout; the `__bmLoreTooltipBound` guard keeps the
// listeners and the popover singleton even if the script is re-evaluated.

(function () {
  if (window.__bmLoreTooltipBound) return;
  window.__bmLoreTooltipBound = true;

  var POPOVER_ID = 'bm-lore-popover';
  var EDGE_GAP = 12;
  var ANCHOR_GAP = 10;

  /** @type {HTMLElement | null} */
  var popover = null;
  /** @type {HTMLElement | null} */
  var anchor = null;

  function ensurePopover() {
    if (popover && popover.isConnected) return popover;

    var existing = document.getElementById(POPOVER_ID);
    popover = existing instanceof HTMLElement ? existing : document.createElement('div');

    if (!popover.id) {
      popover.className = 'lore-popover';
      popover.id = POPOVER_ID;
      popover.setAttribute('role', 'tooltip');
      popover.hidden = true;
    }

    if (!popover.isConnected) document.body.appendChild(popover);
    return popover;
  }

  /**
   * @param {HTMLElement} el
   * @returns {string}
   */
  function definitionOf(el) {
    var value = el.getAttribute('data-tooltip');
    return value === null ? '' : value.trim();
  }

  /**
   * @param {HTMLElement} el
   */
  function position(el) {
    var p = ensurePopover();
    var rect = el.getBoundingClientRect();
    var width = Math.min(360, Math.max(200, window.innerWidth - EDGE_GAP * 2));
    p.style.width = width + 'px';
    p.style.maxWidth = 'calc(100vw - ' + EDGE_GAP * 2 + 'px)';

    var height = p.offsetHeight;
    var below = window.innerHeight - rect.bottom >= height + ANCHOR_GAP + EDGE_GAP;
    var top = below ? rect.bottom + ANCHOR_GAP + window.scrollY : rect.top - ANCHOR_GAP - height + window.scrollY;

    var left = rect.left + window.scrollX;
    left = Math.min(left, window.scrollX + window.innerWidth - width - EDGE_GAP);
    left = Math.max(left, window.scrollX + EDGE_GAP);

    p.style.top = Math.max(window.scrollY + EDGE_GAP, top) + 'px';
    p.style.left = left + 'px';
    p.dataset.side = below ? 'below' : 'above';
  }

  /**
   * @param {string} text
   */
  function render(text) {
    var p = ensurePopover();
    p.textContent = '';

    var body = document.createElement('p');
    body.className = 'lore-popover__definition';
    body.textContent = text;
    p.appendChild(body);
  }

  /**
   * @param {HTMLElement} el
   */
  function show(el) {
    var text = definitionOf(el);
    if (text === '') return;

    anchor = el;
    var p = ensurePopover();
    render(text);
    p.hidden = false;
    position(el);
    el.setAttribute('aria-describedby', POPOVER_ID);
  }

  function hide() {
    if (anchor) anchor.removeAttribute('aria-describedby');
    anchor = null;
    if (popover) popover.hidden = true;
  }

  /**
   * @param {EventTarget | null} target
   * @returns {HTMLElement | null}
   */
  function loreWordFrom(target) {
    if (!(target instanceof Element)) return null;
    var el = target.closest('.lore-word');
    return el instanceof HTMLElement ? el : null;
  }

  document.addEventListener('pointerover', function (event) {
    var el = loreWordFrom(event.target);
    if (el && el !== anchor) show(el);
  });

  document.addEventListener('pointerout', function (event) {
    var el = loreWordFrom(event.target);
    if (!el) return;
    var to = event.relatedTarget;
    if (to instanceof Node && el.contains(to)) return;
    if (anchor === el) hide();
  });

  document.addEventListener('focusin', function (event) {
    var el = loreWordFrom(event.target);
    if (el) show(el);
  });

  document.addEventListener('focusout', function (event) {
    var el = loreWordFrom(event.target);
    if (el && anchor === el) hide();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' || event.key === 'Esc') hide();
  });

  // Scroll (including nested scrollers), resize, language switch and swup page
  // swaps all invalidate the anchor's viewport position: drop the popover.
  window.addEventListener('scroll', hide, { passive: true, capture: true });
  window.addEventListener('resize', hide);
  window.addEventListener('bm:lang', hide);
  document.addEventListener('swup:page:view', hide);
})();
