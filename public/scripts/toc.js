// Hover permalinks for h2/h3 on reading pages. Injected client-side so the
// raw Markdown output stays clean and the admin CMS preview is untouched.
// Idempotent: an existing `.heading-anchor` is reused, never duplicated.
(function () {
  var HEADINGS = '.post-page .markdown-content h2, .post-page .markdown-content h3';

  function lang() {
    return document.documentElement.dataset.lang === 'en' ? 'en' : 'zh';
  }

  // The dictionary lives in the shell script, which runs after <main>, so the
  // first decorate() pass on a full load has no window.T yet. Fall back to the
  // two inline variants; the shell's initial applyLang() dispatches bm:lang,
  // which re-runs decorate() with the dictionary in place.
  /** @param {string | null} text */
  function anchorLabel(text) {
    var name = (text || '').trim();
    var translate = typeof window.T === 'function' ? window.T : null;
    if (translate) {
      var label = translate('heading_anchor', name);
      return name ? label : label.replace(/\s*[:：]\s*$/, '');
    }
    if (lang() === 'en') return name ? 'Section anchor: ' + name : 'Section anchor';
    return name ? '章節錨點：' + name : '章節錨點';
  }

  function decorate() {
    var headings = document.querySelectorAll(HEADINGS);
    for (var i = 0; i < headings.length; i += 1) {
      var heading = headings[i];
      var id = heading.getAttribute('id');
      if (!id) continue;

      var anchor = heading.querySelector('a.heading-anchor');
      if (!anchor) {
        heading.setAttribute('data-anchor-text', (heading.textContent || '').replace(/\s+/g, ' ').trim());
        anchor = document.createElement('a');
        anchor.className = 'heading-anchor';
        anchor.textContent = '#';
        heading.appendChild(anchor);
      }

      anchor.setAttribute('href', '#' + id);
      anchor.setAttribute('aria-label', anchorLabel(heading.getAttribute('data-anchor-text')));
    }
  }

  decorate();

  // The "already bound" flag lives on <html> rather than on `window` so it
  // survives Swup's <main> replacement and needs no extra global. It is set
  // once per full page load, exactly like the listener.
  if (!document.documentElement.hasAttribute('data-bm-heading-anchors-bound')) {
    document.documentElement.setAttribute('data-bm-heading-anchors-bound', '');
    document.addEventListener('swup:page:view', decorate);
    document.addEventListener('swup:content:replace', decorate);
    window.addEventListener('bm:lang', decorate);
  }
})();

// Scroll-spy for the TOC rail. It is deliberately DOM-driven instead of
// observer-driven: Swup replaces <main> on navigation, and re-querying
// `[data-toc-link]` on each tick means no observer has to be re-bound.
(function () {
  var activeLockUntil = 0;
  var lockTimer = 0;
  var tocMobileQuery = window.matchMedia('(max-width: 1079px)');

  // Keep the TOC visible without JavaScript. Once this controller is ready,
  // mobile gets a collapsed-by-default disclosure; desktop always stays open.
  function syncTocControls() {
    var tocs = document.querySelectorAll('[data-post-toc]');
    for (var i = 0; i < tocs.length; i += 1) {
      var toc = tocs[i];
      var button = toc.querySelector('[data-toc-toggle]');
      if (tocMobileQuery.matches) {
        toc.setAttribute('data-toc-collapsible', '');
        if (button) button.setAttribute('aria-expanded', toc.classList.contains('is-open') ? 'true' : 'false');
      } else {
        toc.removeAttribute('data-toc-collapsible');
        toc.classList.remove('is-open');
        if (button) button.setAttribute('aria-expanded', 'true');
      }
    }
  }

  function alignToc() {
    var main = /** @type {HTMLElement | null} */ (document.querySelector('.article-main'));
    var toc = /** @type {HTMLElement | null} */ (document.querySelector('.post-toc'));
    if (!main || !toc) return;
    var top = Math.max(96, Math.round(main.getBoundingClientRect().top));
    toc.style.setProperty('--toc-top', top + 'px');
  }

  function update() {
    // A click on a TOC link wins briefly so the two headings at the very
    // bottom of a short page (which cannot scroll past the threshold) still
    // show their own active marker. If the reader keeps scrolling during that
    // window, re-run once it expires so the marker cannot stay stale.
    if (Date.now() < activeLockUntil) {
      if (!lockTimer) {
        lockTimer = window.setTimeout(
          function () {
            lockTimer = 0;
            update();
          },
          activeLockUntil - Date.now() + 20,
        );
      }
      return;
    }

    var links = document.querySelectorAll('[data-toc-link]');
    if (!links.length) return;

    var threshold = window.scrollY + 140;
    var current = null;

    for (var i = 0; i < links.length; i += 1) {
      var id = links[i].getAttribute('data-toc-link');
      var target = id ? document.getElementById(id) : null;
      if (!target) continue;
      if (target.getBoundingClientRect().top + window.scrollY <= threshold) current = links[i];
    }

    // At the bottom of the document the last heading cannot reach the
    // threshold; highlight the final TOC entry instead of leaving none.
    var atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 120;
    if (atBottom && links.length > 0) current = links[links.length - 1];

    setActive(current);
  }

  /** @param {Element | null} current */
  function setActive(current) {
    var links = document.querySelectorAll('[data-toc-link]');
    for (var j = 0; j < links.length; j += 1) {
      var active = links[j] === current;
      links[j].classList.toggle('active', active);
      if (active) links[j].setAttribute('aria-current', 'location');
      else links[j].removeAttribute('aria-current');
    }
    positionIndicator(current);
  }

  // The accent bar is one absolutely-positioned element instead of a border on
  // every row: moving it is a transform, so scroll-spy updates never relayout
  // the list. offsetTop is measured against .post-toc__body (position:relative).
  /** @param {Element | null} current */
  function positionIndicator(current) {
    var body = document.querySelector('.post-toc__body');
    var indicator = body ? body.querySelector('[data-toc-indicator]') : null;
    if (!body || !(indicator instanceof HTMLElement)) return;
    if (!current || !body.contains(current)) {
      indicator.style.opacity = '0';
      return;
    }
    var link = /** @type {HTMLElement} */ (current);
    indicator.style.transform = 'translateY(' + link.offsetTop + 'px)';
    indicator.style.height = link.offsetHeight + 'px';
    indicator.style.opacity = '1';
  }

  if (!window.__bmTocBound) {
    window.__bmTocBound = true;
    var frame = 0;
    window.addEventListener(
      'scroll',
      function () {
        if (frame) return;
        frame = requestAnimationFrame(function () {
          frame = 0;
          update();
        });
      },
      { passive: true },
    );
    window.addEventListener('resize', function () {
      syncTocControls();
      alignToc();
      update();
    });
    window.addEventListener('load', update);
    window.addEventListener('load', alignToc);
    document.addEventListener('swup:page:view', function () {
      syncTocControls();
      alignToc();
      update();
    });

    document.addEventListener('click', function (/** @type {MouseEvent} */ event) {
      var target = event.target;
      if (!(target instanceof Element)) return;

      var toggle = target.closest('[data-toc-toggle]');
      if (toggle instanceof HTMLButtonElement) {
        var toc = toggle.closest('[data-post-toc]');
        if (toc) {
          var isOpen = toc.classList.toggle('is-open');
          toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
          // Re-measure after the disclosure opens: the rows were collapsed
          // (max-height:0) while closed, so offsets are only valid now.
          update();
        }
        return;
      }

      var link = target.closest('[data-toc-link]');
      if (!(link instanceof HTMLElement)) return;
      activeLockUntil = Date.now() + 1500;
      setActive(link);
      var parentToc = link.closest('[data-post-toc]');
      if (parentToc && parentToc.hasAttribute('data-toc-collapsible')) {
        parentToc.classList.remove('is-open');
        var parentToggle = parentToc.querySelector('[data-toc-toggle]');
        if (parentToggle) parentToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  syncTocControls();
  alignToc();
  update();
})();
