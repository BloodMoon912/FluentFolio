// Persistent visit beacon.
//
// One beacon per path per tab, sent on the first load and on every swup
// navigation. Loaded from BaseLayout.astro with `data-swup-ignore-script`, so it
// runs once per full page load and owns its own swup listener instead of being
// re-initialised by the homepage dashboard.
//
// Semantics (audit 2026-11 items #1, #2, #9):
//
//   - The server records a *view* for every beacon, not one per browser. The
//     visit cookie only tells the server "returning visitor", which suppresses
//     Turnstile; it no longer suppresses the write.
//   - `document.referrer` is only attached to the first beacon of the tab. On
//     later SPA navigations the browser's document.referrer still points at the
//     original entry page, so sending it again would corrupt the referrer
//     statistics. The server never reads the `Referer` header for this.
//   - Each path is sent at most once per tab (in-memory Set, no storage), and
//     admin/API/OG routes are never sent.
//   - Turnstile is asked for a token only when the Worker explicitly answers
//     `403 { reason: 'missing-token' }`, at most once per tab, and never retried
//     on any other rejection. Read the "Turnstile policy" section of AGENTS.md
//     before changing this: an earlier version of this flow looped.
(function () {
  if (window.__bmVisitBeaconInstalled) return;
  window.__bmVisitBeaconInstalled = true;

  /** Paths that are never visitor-facing (prefix match, per the audit spec). */
  var IGNORED_PREFIXES = ['/admin', '/api', '/og'];

  /** Paths already sent (or attempted) by this tab. No storage on purpose. */
  /** @type {Set<string>} */
  var seen = new Set();

  /** The first beacon of the tab carries document.referrer; later ones don't. */
  var firstBeacon = true;

  /** @param {string} pathname */
  function isIgnored(pathname) {
    for (var i = 0; i < IGNORED_PREFIXES.length; i += 1) {
      if (pathname.indexOf(IGNORED_PREFIXES[i]) === 0) return true;
    }
    return false;
  }

  /**
   * @param {{ path: string, referrer?: string }} body
   * @param {string} [token]
   */
  function postVisit(body, token) {
    /** @type {{ path: string, referrer?: string, 'cf-turnstile-response'?: string }} */
    var payload = { path: body.path };
    if (body.referrer) payload.referrer = body.referrer;
    if (token) payload['cf-turnstile-response'] = token;

    return fetch('/api/visitors', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      credentials: 'same-origin',
      mode: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify(payload),
    });
  }

  async function sendVisit() {
    var pathname = location.pathname;
    if (!pathname || pathname.charAt(0) !== '/' || isIgnored(pathname) || seen.has(pathname)) return;

    // Marked before the request: a repeated page:view for the same page (or a
    // rapid back/forward) must never produce a second POST.
    seen.add(pathname);

    var body = { path: pathname, referrer: '' };
    if (firstBeacon) {
      firstBeacon = false;
      body.referrer = typeof document.referrer === 'string' ? document.referrer : '';
    }

    try {
      var response = await postVisit(body);

      if (!response.ok) {
        var verdict = await response.json().catch(function () {
          return null;
        });

        // Exactly one challenge per tab, and only when the Worker explicitly
        // asks for a token. The flag is set before the attempt so no later
        // navigation can start a second one — retrying on a rejection is what
        // turned a rejected token into an endless loop.
        if (verdict && verdict.reason === 'missing-token' && !window.__bmVisitChallengeAttempted) {
          window.__bmVisitChallengeAttempted = true;
          try {
            // Relative to this module's URL (/scripts/visit-beacon.js), so it
            // resolves to the same /scripts/turnstile-client.js the browser
            // would load from an absolute path — and tsc can type it.
            var turnstile = await import('./turnstile-client.js');
            var token = (await turnstile.requestTurnstileToken('visit')).token;
            await postVisit(body, token);
          } catch (error) {
            // The challenge gave up; this view is simply not recorded.
          }
        }
      }
    } catch (error) {
      // Visitor analytics must never affect normal navigation.
    }
  }

  sendVisit();

  // Swup only replaces <main>; this listener survives for the tab's lifetime.
  document.addEventListener('swup:page:view', sendVisit);
})();
