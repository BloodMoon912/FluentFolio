// Shared Turnstile client helper.
//
// Usage from any page:
//
//   const { requestTurnstileToken, cleanupTurnstile } = await import('/scripts/turnstile-client.js');
//   const { token } = await requestTurnstileToken('visit');
//   const res = await fetch('/api/visitors', {
//     method: 'POST',
//     headers: { 'content-type': 'application/json' },
//     body: JSON.stringify({ path: location.pathname, 'cf-turnstile-response': token }),
//   });
//
// The `action` string must match the `expectedAction` the backend route passes
// to `verifyTurnstileToken()` in src/lib/turnstile.ts.
//
// ---------------------------------------------------------------------------
// Why this file looks the way it does
// ---------------------------------------------------------------------------
//
// An earlier version of this helper, combined with its caller, produced an
// endless challenge loop: the caller answered *every* non-2xx response with
// `reset()`, which re-armed the widget immediately and without a retry limit,
// while the backend rejected every token (see src/lib/turnstile.ts for the
// server half of that story). A second symptom came from the widget itself:
// a rendered widget is never really "done" — it keeps its own refresh cycle, so
// one left rendered after its token had been spent could pop an interactive
// challenge again minutes later with nobody touching the page.
//
// The rules that keep that from coming back:
//
//   1. There is NO `reset()` here. A caller cannot ask for another challenge;
//      it can only ask for a token, once, and then decide what to do.
//   2. A token is single-use, so the widget is removed the moment it produces
//      one. Nothing is left rendered to refresh in the background.
//   3. `refresh-expired: 'never'`, `refresh-timeout: 'manual'` and
//      `retry: 'never'` turn off Turnstile's own automatic re-arming.
//   4. `expired-callback` fails the request. It must never re-arm the widget.
//   5. At most one widget exists per page, no matter how many times the calling
//      page script re-runs (Swup navigation re-executes it), and concurrent
//      callers share one in-flight request.
//
// This module is loaded via dynamic `import()`, so the browser caches it and
// its module state (the overlay, the loader promise, the widget id) survives
// repeated `import()` calls for the lifetime of the page.

// Must match the Turnstile widget whose secret key is stored on the Worker as
// TURNSTILE_SECRET. Changing one without the other silently breaks verification.
const SITEKEY = '0x4AAAAAAEubO6tRmWSwdMdT';

// How long to wait before Cloudflare decides whether a human is needed at all.
const INVISIBLE_PHASE_TIMEOUT_MS = 15000;
// Absolute cap once an interactive challenge is on screen, so the awaiting
// caller can never hang forever if the visitor simply walks away.
const INTERACTIVE_PHASE_TIMEOUT_MS = 120000;

/** @type {Promise<TurnstileApi> | null} */
let scriptLoaderPromise = null;
/** @type {HTMLElement | null} */
let overlayEl = null;
/** @type {HTMLElement | null} */
let widgetContainerEl = null;
/** @type {string | null} */
let activeWidgetId = null;
/** @type {Promise<{ token: string }> | null} */
let inFlight = null;

/** @returns {Promise<TurnstileApi>} */
function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptLoaderPromise) return scriptLoaderPromise;

  scriptLoaderPromise = new Promise((resolve, reject) => {
    const script = /** @type {HTMLScriptElement} */ (
      document.querySelector('script[data-bm-turnstile]') || document.createElement('script')
    );
    script.addEventListener('load', () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile unavailable')),
    );
    script.addEventListener(
      'error',
      () => {
        scriptLoaderPromise = null;
        reject(new Error('turnstile failed to load'));
      },
      { once: true },
    );
    if (!script.parentNode) {
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.dataset.bmTurnstile = 'true';
      document.head.appendChild(script);
    }
  });

  return scriptLoaderPromise;
}

/** @returns {HTMLElement} */
function ensureModal() {
  if (overlayEl && overlayEl.isConnected) return overlayEl;

  // Reacquire an overlay left behind by a previous evaluation of this module
  // (a hard reload re-runs it, but the DOM it built may still be present).
  const existing = document.getElementById('bm-turnstile-overlay');
  if (existing) {
    overlayEl = existing;
    widgetContainerEl = /** @type {HTMLElement | null} */ (existing.querySelector('.visit-turnstile'));
    return overlayEl;
  }

  overlayEl = document.createElement('div');
  overlayEl.id = 'bm-turnstile-overlay';
  overlayEl.className = 'turnstile-modal-overlay';
  overlayEl.hidden = true;

  const card = document.createElement('div');
  card.className = 'turnstile-modal-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');

  const title = document.createElement('div');
  title.className = 'turnstile-modal-title';
  // window.T is installed by BaseLayout; fall back to English if a page is
  // rendered without it.
  title.textContent = (window.T ? window.T('security_check') : null) || 'Security check';
  card.setAttribute('aria-label', title.textContent);

  widgetContainerEl = document.createElement('div');
  widgetContainerEl.className = 'visit-turnstile';

  card.append(title, widgetContainerEl);
  overlayEl.appendChild(card);
  document.body.appendChild(overlayEl);
  return overlayEl;
}

function showModal() {
  const overlay = ensureModal();
  overlay.hidden = false;
  document.documentElement.classList.add('bm-verification-active');
  requestAnimationFrame(() => overlay.classList.add('is-open'));
}

function hideModal() {
  if (!overlayEl) return;
  overlayEl.classList.remove('is-open');
  document.documentElement.classList.remove('bm-verification-active');
  setTimeout(() => {
    if (overlayEl && !overlayEl.classList.contains('is-open')) overlayEl.hidden = true;
  }, 320);
}

/**
 * Unregister the current widget from turnstile.js's internal state.
 *
 * This is the only way this module releases a widget, and it is always called
 * before a new one is created and immediately after a token is produced. Safe
 * to call when there is no active widget.
 */
export function removeActiveWidget() {
  if (activeWidgetId !== null && window.turnstile) {
    try {
      window.turnstile.remove(activeWidgetId);
    } catch {
      // The widget's DOM node may already be gone; there is nothing to release.
    }
  }
  activeWidgetId = null;
}

/**
 * Run one Turnstile challenge for `action` and resolve with a single-use token.
 *
 * Renders invisibly: `appearance: 'interaction-only'` means Cloudflare only puts
 * a challenge on screen when it actually suspects automation. Callers must not
 * loop on failure — a rejected token means "skip this optional request", not
 * "ask the visitor again".
 *
 * @param {string} action 1-32 chars, letters/numbers/underscore/hyphen. Must
 *   equal the `expectedAction` the backend passes to `verifyTurnstileToken()`.
 * @returns {Promise<{ token: string }>}
 */
export function requestTurnstileToken(action) {
  // Concurrent callers (for example a page script re-run by Swup while the
  // previous request is still pending) share one request and one widget.
  if (inFlight) return inFlight;

  inFlight = loadTurnstileScript()
    .then(
      (turnstile) =>
        new Promise((resolve, reject) => {
          removeActiveWidget();
          ensureModal();
          const container = /** @type {HTMLElement} */ (widgetContainerEl);
          if (widgetContainerEl) widgetContainerEl.innerHTML = '';

          /** @type {number | null} */
          let invisibleTimer = setTimeout(() => fail('client-timeout'), INVISIBLE_PHASE_TIMEOUT_MS);
          /** @type {number | null} */
          let interactiveTimer = null;
          let settled = false;
          let widgetId = null;

          function clearTimers() {
            clearTimeout(invisibleTimer ?? undefined);
            if (interactiveTimer !== null) clearTimeout(interactiveTimer);
            invisibleTimer = null;
            interactiveTimer = null;
          }

          /** @param {string} reason */
          function fail(reason) {
            if (settled) return;
            settled = true;
            clearTimers();
            removeActiveWidget();
            hideModal();
            console.warn('[turnstile]', reason);
            reject(new Error(`turnstile failed: ${reason}`));
          }

          /** @param {string} token */
          function succeed(token) {
            if (settled) return;
            settled = true;
            clearTimers();
            // The token is single-use and already minted, so the widget has no
            // further job. Remove it now: leaving it rendered is what allowed a
            // challenge to reappear by itself minutes later.
            removeActiveWidget();
            hideModal();
            resolve({ token });
          }

          try {
            widgetId = turnstile.render(container, {
              sitekey: SITEKEY,
              action,
              appearance: 'interaction-only',
              execution: 'execute',
              theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
              // Turnstile's own automatic re-arming is off. Without these the
              // widget keeps trying to refresh its token in the background and
              // can put a challenge on screen with no user action at all.
              'refresh-expired': 'never',
              'refresh-timeout': 'manual',
              retry: 'never',
              callback: (token) => succeed(token),
              'before-interactive-callback': () => {
                // A human is now looking at the challenge, so the 15s budget no
                // longer applies; switch to the absolute cap instead.
                clearTimeout(invisibleTimer ?? undefined);
                invisibleTimer = null;
                interactiveTimer = setTimeout(() => fail('interactive-timeout'), INTERACTIVE_PHASE_TIMEOUT_MS);
                showModal();
              },
              'after-interactive-callback': hideModal,
              // Must not re-arm the widget: expiry means this attempt is over.
              'expired-callback': () => fail('expired'),
              'error-callback': (errorCode) => fail(`error-callback: ${errorCode}`),
              'timeout-callback': () => fail('timeout-callback'),
            });
            activeWidgetId = widgetId;
            // Keep token acquisition under our control rather than letting a
            // rendered widget start its own verification cycle.
            turnstile.execute(widgetId);
          } catch (err) {
            fail(err instanceof Error && err.message ? err.message : 'render-exception');
          }
        }),
    )
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Call from a page-teardown hook before the widget's DOM region is swapped out. */
export function cleanupTurnstile() {
  removeActiveWidget();
  hideModal();
}
