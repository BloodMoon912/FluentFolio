// A single /api/status response is the shared source of truth for both
// the homepage and the full status page. This avoids six independent
// browser probes and prevents the status UI from getting stuck forever.
// #7: polling pauses while the tab is hidden, refreshes immediately when it
// returns, and backs off exponentially (capped at five minutes) on errors.
(function () {
  /** @type {Window & { __bmStatusCleanup?: () => void }} */
  const win = window;
  if (win.__bmStatusCleanup) win.__bmStatusCleanup();

  /** @type {(key: string, ...args: Array<string | number>) => string} */
  const t = (key, ...args) => (win.T ? win.T(key, ...args) : key);
  const HKT = 'Asia/Hong_Kong';
  const BASE_DELAY_MS = 30000;
  const MAX_DELAY_MS = 300000;

  let running = false;
  /** @type {number | null} */
  let pollTimer = null;
  /** @type {number | null} */
  let clockTimer = null;
  let nextDelayMs = BASE_DELAY_MS;

  /**
   * @param {Element | null | undefined} el
   * @param {unknown} value
   */
  function setText(el, value) {
    if (el) el.textContent = String(value ?? '—');
  }

  function locale() {
    return win.getLang && win.getLang() === 'en' ? 'en-GB' : 'zh-HK';
  }

  /** @param {number | string | Date} value */
  function clockText(value) {
    return new Intl.DateTimeFormat(locale(), {
      timeZone: HKT,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(value));
  }

  function updateLiveClock() {
    const now = new Date();
    const time = new Intl.DateTimeFormat(locale(), {
      timeZone: HKT,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(now);
    const date = new Intl.DateTimeFormat(locale(), {
      timeZone: HKT,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }).format(now);
    setText(document.getElementById('live-clock'), time);
    setText(document.getElementById('live-date'), date);
  }

  /**
   * @param {string} url
   * @param {number} [timeoutMs]
   * @returns {Promise<{ response: Response, json: StatusJson }>}
   */
  async function fetchJson(url, timeoutMs = 8000) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
      const text = await response.text();
      /** @type {StatusJson} */
      let json = /** @type {StatusJson} */ ({});
      try {
        json = text ? JSON.parse(text) : /** @type {StatusJson} */ ({});
      } catch {}
      return { response, json };
    } finally {
      clearTimeout(timeout);
    }
  }

  /** @param {StatusSystemJson | undefined} system */
  function applySystem(system) {
    const edge = system?.edge || {};
    /** @type {Record<string, string>} */
    const rows = {
      runtime: system?.runtime || 'Cloudflare Workers',
      colo: edge.colo || '—',
      location: [edge.city, edge.region, edge.country].filter(Boolean).join(', ') || '—',
      httpProtocol: edge.httpProtocol || '—',
      tlsVersion: edge.tlsVersion || '—',
      now: system?.now ? clockText(system.now) : '—',
    };
    document.querySelectorAll('[data-system-value]').forEach((el) => {
      const key = el.getAttribute('data-system-value');
      if (key && key in rows) el.textContent = rows[key];
    });
  }

  /** @param {StatusServiceJson} result */
  function serviceDetail(result) {
    switch (result.detailCode) {
      case 'worker_ok':
        return t('worker_ok');
      case 'db_ok':
        return t('db_ok');
      case 'db_error':
        return t('db_error');
      case 'd1_not_configured':
        return t('d1_not_configured');
      case 'presence_ok':
        return t('presence_ok');
      case 'presence_unavailable':
        return t('presence_unavailable');
      case 'steam_api_ok':
        return t('steam_api_ok');
      case 'steam_api_unavailable':
        return t('steam_api_unavailable');
      default:
        return result.ok ? t('endpoint_ok') : t('unavailable');
    }
  }

  /**
   * @param {string} name
   * @param {StatusServiceJson} result
   */
  function applyService(name, result) {
    const row = document.querySelector(`[data-service="${name}"]`);
    const status = row?.querySelector('[data-status]');
    const latency = row?.querySelector('[data-latency]');
    const detail = row?.querySelector('[data-detail]');
    if (!status) return;
    const ok = Boolean(result.ok);
    status.className = `service-status ${ok ? 'good' : 'bad'}`;
    status.innerHTML = `<span class="pulse"></span>${ok ? t('normal') : t('abnormal')}`;
    const latencyMs = Number(result.latencyMs);
    setText(latency, Number.isFinite(latencyMs) ? `${Math.round(latencyMs)} ms` : '—');
    setText(detail, serviceDetail(result));
  }

  /** @param {StatusHistoryJson[] | undefined} history */
  function renderHistory(history) {
    const container = document.getElementById('status-history');
    const empty = document.getElementById('status-history-empty');
    const summary = document.getElementById('status-history-summary');
    if (!container) return;
    container.textContent = '';
    const entries = Array.isArray(history) ? history : [];
    if (entries.length === 0) {
      if (empty) empty.hidden = false;
      if (summary) summary.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;

    const fragment = document.createDocumentFragment();
    let degraded = 0;
    entries.forEach((entry) => {
      const ok = Boolean(entry.ok);
      if (!ok) degraded += 1;
      const bar = document.createElement('span');
      bar.className = `status-history-bar ${ok ? 'good' : 'bad'}`;
      const failing =
        ok || !entry.detail || entry.detail === 'ok'
          ? ''
          : ` · ${entry.detail
              .split(',')
              .map((key) => t(`service_${key}`))
              .join(', ')}`;
      bar.title = `${clockText(entry.checkedAt * 1000)} · ${ok ? t('normal') : t('abnormal')}${failing}`;
      fragment.appendChild(bar);
    });
    container.appendChild(fragment);

    if (summary) {
      summary.hidden = false;
      summary.textContent = t('status_history_summary', entries.length, degraded);
    }
  }

  /**
   * @param {StatusJson} j
   * @param {Response} response
   */
  function updateHealthFromStatus(j, response) {
    const website = (j.services || []).find((x) => x.key === 'website');
    const database = (j.services || []).find((x) => x.key === 'database');
    const summary = document.getElementById('health-summary');
    if (summary)
      summary.innerHTML = `
      <div class="health-row"><span>${t('service')}</span><strong>personal-site</strong></div>
      <div class="health-row"><span>${t('database')}</span><strong>${database?.ok ? t('normal') : t('abnormal')}</strong></div>
      <div class="health-row"><span>${t('http_status')}</span><strong>${response.status}</strong></div>
      <div class="health-row"><span>${t('response_time')}</span><strong>${website?.latencyMs ? `${Math.round(website.latencyMs)} ms` : '—'}</strong></div>`;
    const pill = document.getElementById('health-pill');
    if (pill) {
      pill.textContent = database?.ok ? t('health') : t('abnormal');
      pill.className = `status-badge ${database?.ok ? 'playing' : ''}`;
    }
    const raw = document.getElementById('health');
    if (raw) raw.textContent = JSON.stringify(j, null, 2);
  }

  /** @returns {Promise<boolean>} whether the refresh succeeded */
  async function check() {
    if (running) return true;
    running = true;
    const overall = document.getElementById('overall');
    const overallLabel = document.getElementById('overall-label');
    const checked = document.getElementById('checked');
    try {
      setText(checked, t('checking_ellipsis'));
      const { response, json } = await fetchJson('/api/status');
      if (!response.ok || !json?.services) throw new Error('status endpoint unavailable');

      (json.services || []).forEach((result) => applyService(result.key, result));
      applySystem(json.system);
      updateHealthFromStatus(json, response);
      renderHistory(json.history);

      const allGood = json.services.every((x) => x.ok);
      const degraded = json.services.some((x) => x.ok) && !allGood;
      if (overall) overall.className = `status-overall ${allGood ? 'good' : degraded ? 'warn' : 'bad'}`;
      setText(overallLabel, allGood ? t('all_services_ok') : degraded ? t('some_degraded') : t('services_unavailable'));
      setText(checked, t('last_checked', clockText(new Date())));
      return true;
    } catch {
      // Never leave a page permanently in "Reading". A failed refresh is
      // shown as unavailable for the live checks, while the rest of the
      // page remains usable and the next poll backs off.
      document.querySelectorAll('[data-service] [data-status]').forEach((el) => {
        el.className = 'service-status bad';
        el.innerHTML = `<span class="pulse"></span>${t('unavailable')}`;
      });
      document.querySelectorAll('[data-service] [data-detail]').forEach((el) => (el.textContent = t('no_response')));
      if (overall) overall.className = 'status-overall bad';
      setText(overallLabel, t('services_unavailable'));
      setText(checked, t('no_response'));
      return false;
    } finally {
      running = false;
    }
  }

  function clearPoll() {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function stopClock() {
    if (clockTimer !== null) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  }

  function startClock() {
    stopClock();
    updateLiveClock();
    clockTimer = window.setInterval(updateLiveClock, 1000);
  }

  /** Runs one check, then schedules the next one unless the tab is hidden. */
  async function pollOnce() {
    pollTimer = null;
    const ok = await check();
    if (document.hidden) return;
    nextDelayMs = ok ? BASE_DELAY_MS : Math.min(nextDelayMs * 2, MAX_DELAY_MS);
    pollTimer = window.setTimeout(pollOnce, nextDelayMs);
  }

  /** Immediate refresh, resetting the backoff, when the tab becomes visible. */
  function refreshNow() {
    clearPoll();
    if (document.hidden) return;
    nextDelayMs = BASE_DELAY_MS;
    pollTimer = window.setTimeout(pollOnce, 0);
  }

  const onVisibility = () => {
    if (document.hidden) {
      clearPoll();
      stopClock();
    } else {
      startClock();
      refreshNow();
    }
  };

  const onLang = () => {
    updateLiveClock();
    refreshNow();
  };

  startClock();
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('bm:lang', onLang);
  refreshNow();

  win.__bmStatusCleanup = () => {
    clearPoll();
    stopClock();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('bm:lang', onLang);
  };
})();
