// Homepage dashboard: the four live panels (Discord presence, Steam, visitor
// statistics, service health).
//
// The visit beacon is NOT here: it is a persistent script in BaseLayout.astro
// (public/scripts/visit-beacon.js) because it has to run on every page, not just
// the homepage, and it owns the one Turnstile challenge a tab is allowed.
//
// Loaded by /scripts/home-bootstrap.js rather than bundled, because swup
// (reloadScripts: true) re-executes that bootstrap inside <main> on every
// navigation and that re-execution is what re-initialises the dashboard.
// initHomeDashboard() therefore starts by calling window.__bmHomeCleanup() to
// tear down the previous run.

// --- Types for the JSON this script consumes ---------------------------------
// The API payloads are written by src/pages/api/visitors.ts, activity.ts and
// steam.ts. They are declared structurally here rather than imported, because
// this file is copied verbatim into dist/client and must stay dependency-free.

/**
 * @typedef {Object} DailyEntry
 * @property {string} day
 * @property {number | string} [views]
 */
/** @typedef {{ path: string, views?: number | string }} PathEntry */
/** @typedef {{ country?: string, views?: number | string }} CountryEntry */
/** @typedef {{ host?: string, views?: number | string }} ReferrerEntry */
/** @typedef {{ label?: string, url?: string }} ActivityButton */

/** @typedef {{ name?: string, ok?: boolean, key?: string }} ServiceStatus */

/**
 * @typedef {Object} LanyardAsset
 * @property {string} [large_image]
 * @property {string} [small_image]
 * @property {string} [large_text]
 * @property {string} [small_text]
 * @property {string} [large_url]
 */

/** @typedef {{ start?: number, end?: number }} LanyardTimestamps */

/**
 * @typedef {Object} LanyardActivity
 * @property {number} [type]
 * @property {number} [typeId]
 * @property {string} [name]
 * @property {string} [details]
 * @property {string} [state]
 * @property {string} [application_id]
 * @property {LanyardAsset} [assets]
 * @property {LanyardTimestamps} [timestamps]
 * @property {(ActivityButton | string)[]} [buttons]
 * @property {string} [largeText]
 * @property {string} [smallText]
 * @property {string | null} [largeImage]
 * @property {string | null} [largeImageFallback]
 * @property {string | null} [smallImage]
 * @property {number | null} [startedAt]
 * @property {number | null} [endAt]
 * @property {{ name?: string }} [emoji]
 */

/**
 * @typedef {Object} PrimaryActivity
 * @property {string} type A translated label, not the numeric Discord type.
 * @property {number} typeId
 * @property {string} name
 * @property {string} details
 * @property {string} state
 * @property {string | null} largeImage
 * @property {string | null} largeImageFallback
 * @property {string} largeText
 * @property {string | null} smallImage
 * @property {string} smallText
 * @property {number | null} startedAt
 * @property {number | null} endAt
 * @property {ActivityButton[]} buttons
 */

/**
 * @typedef {Object} LanyardUser
 * @property {string} [id]
 * @property {string} [global_name]
 * @property {string} [display_name]
 * @property {string} [displayName]
 * @property {string} [username]
 * @property {string} [handle]
 * @property {string | null} [avatar]
 */

/**
 * @typedef {Object} LanyardSpotify
 * @property {string} [song]
 * @property {string} [artist]
 * @property {string} [album]
 * @property {string} [album_art_url]
 * @property {LanyardTimestamps} [timestamps]
 */

/**
 * @typedef {Object} LanyardPresence
 * @property {LanyardActivity[]} [activities]
 * @property {LanyardUser} discord_user
 * @property {string} [discord_status]
 * @property {LanyardSpotify} [spotify]
 * @property {boolean} [active_on_discord_desktop]
 * @property {boolean} [active_on_discord_mobile]
 * @property {boolean} [active_on_discord_web]
 */

/**
 * @typedef {Object} MusicView
 * @property {string} song
 * @property {string} artist
 * @property {string} album
 * @property {string | null} albumArt
 * @property {number | null} startedAt
 * @property {number | null} endAt
 */

/**
 * @typedef {Object} ActivityView
 * @property {boolean} [available]
 * @property {LanyardUser} [user]
 * @property {string} [status]
 * @property {string} [statusLabel]
 * @property {{ text?: string, emoji?: string | null } | null} [customStatus]
 * @property {PrimaryActivity | null} [primaryActivity]
 * @property {LanyardActivity[]} [activities]
 * @property {MusicView | null} [spotify]
 * @property {boolean} [desktop]
 * @property {boolean} [mobile]
 * @property {boolean} [web]
 */

/** @typedef {{ name?: string, playtime2WeeksMinutes?: number | string, iconUrl?: string }} SteamGame */

/**
 * Narrow the view's activity buttons (objects) from a raw Lanyard payload's
 * buttons (strings, in the presence wire format).
 *
 * @param {ActivityButton | string} button
 * @returns {button is ActivityButton}
 */
function isActivityButton(button) {
  return typeof button === 'object' && Boolean(button && button.url);
}

export function initHomeDashboard() {
  // Wrapped in an IIFE: swup (reloadScripts:true) re-executes this <script>
  // on every SPA navigation back to "/". Top-level let/const would then
  // collide with the previous execution's bindings and throw a
  // SyntaxError ("already declared"), silently killing the whole script
  // before it could refresh any of the "讀取中" placeholders. Scoping
  // everything inside a function avoids the redeclaration, and the cleanup
  // below stops the previous run's timers/socket instead of leaking them.
  (async function () {
    if (window.__bmHomeCleanup) window.__bmHomeCleanup();
    /** @type {(key: string, ...args: unknown[]) => string} */
    const t = (k, ...a) => (window.T ? window.T(k, ...a) : k);
    /**
     * @param {string} id
     * @param {string | number} value
     */
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(value);
    };
    // Verbatim copy of escapeHtml() from src/lib/escape-html.ts. This file is
    // served verbatim and cannot import that module; keep the two in step.
    /** @type {Record<string, string>} */
    const htmlEscapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    /** @param {unknown} value */
    const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => htmlEscapes[c]);
    /** @param {string | undefined} code */
    const statusLabel = (code) => t(code || 'unknown');

    async function loadVisitors() {
      try {
        const r = await fetch('/api/visitors', { cache: 'no-store' });
        if (!r.ok) return false;
        const j = /** @type {any} */ (await r.json());
        if (!j.configured) return true;
        const daily = /** @type {DailyEntry[]} */ (Array.isArray(j.daily) ? j.daily : []);
        setText('visitor-total', Number(j.total || 0).toLocaleString());
        setText('visitor-unique', Number(j.uniqueVisitors || 0).toLocaleString());
        setText('visitor-24h', Number(j.last24h || 0).toLocaleString());
        setText('visitor-7d', Number(daily.reduce((sum, d) => sum + Number(d.views || 0), 0)).toLocaleString());
        const chart = document.getElementById('visitor-chart');
        if (chart) {
          const max = Math.max(1, ...daily.map((d) => Number(d.views || 0)));
          // The API returns a 30-day trend (#8) while the card's CSS grid is a
          // fixed seven-column chart, so the column count follows the data here
          // instead of needing a stylesheet change. At that density only every
          // fifth bar gets a label, otherwise the date labels collide.
          chart.style.gridTemplateColumns = daily.length ? `repeat(${daily.length}, minmax(0, 1fr))` : '';
          chart.innerHTML = daily
            .map((d, index) => {
              const value = Number(d.views || 0);
              const height = value === 0 ? 0 : Math.max(8, Math.round((value / max) * 100));
              // `d.day` is a plain `YYYY-MM-DD` (UTC) string; format it directly so
              // the browser's time zone can never shift the label by a day.
              const [, month = '', dayOfMonth = ''] = String(d.day).split('-');
              const label = `${Number(month)}/${Number(dayOfMonth)}`;
              const showLabel = index === 0 || index === daily.length - 1 || index % 5 === 0;
              return `<div class="bar-wrap"><div class="bar${value === 0 ? ' is-empty' : ''}" style="height:${height}%" title="${label}：${t('views', String(value))}"></div><span>${showLabel ? label : ''}</span></div>`;
            })
            .join('');
        }
        const paths = document.getElementById('visitor-paths');
        if (paths) {
          const list = /** @type {PathEntry[]} */ (j.topPaths || []);
          paths.innerHTML = `<div class="tiny">${t('top_paths')}</div>${list.map((item) => `<div class="path-row"><span title="${escapeHtml(item.path)}">${escapeHtml(item.path)}</span><strong>${Number(item.views || 0).toLocaleString()}</strong></div>`).join('')}`;
        }
        const countries = document.getElementById('visitor-countries');
        if (countries) {
          const list = /** @type {CountryEntry[]} */ (Array.isArray(j.topCountries) ? j.topCountries : []);
          countries.innerHTML = list.length
            ? `<div class="tiny">${t('top_countries')}</div>${list.map((item) => `<div class="path-row"><span>${escapeHtml(item.country || t('unknown_country'))}</span><strong>${Number(item.views || 0).toLocaleString()}</strong></div>`).join('')}`
            : '';
        }
        const referrers = document.getElementById('visitor-referrers');
        if (referrers) {
          const list = /** @type {ReferrerEntry[]} */ (Array.isArray(j.topReferrers) ? j.topReferrers : []);
          const directRow = `<div class="path-row"><span>${escapeHtml(t('direct_traffic'))}</span><strong>${Number(j.direct || 0).toLocaleString()}</strong></div>`;
          referrers.innerHTML = `<div class="tiny">${t('top_referrers')}</div>${directRow}${list.map((item) => `<div class="path-row"><span title="${escapeHtml(item.host)}">${escapeHtml(item.host)}</span><strong>${Number(item.views || 0).toLocaleString()}</strong></div>`).join('')}`;
        }
      } catch {
        return false;
      }
      return true;
    }

    /** @type {number | null} */ let activityStartedAt = null;
    /** @type {number | null} */ let activityEndAt = null;
    /** @type {number | null} */ let secondaryActivityStartedAt = null;
    /** @type {number | null} */ let secondaryActivityEndAt = null;
    /** @type {number | null} */ let activityInterval = null;
    /** @type {WebSocket | null} */ let lanyardSocket = null;
    let lanyardReconnectAttempts = 0;
    /** @type {number | null} */ let lanyardHeartbeat = null;
    /** @type {number | null} */ let lanyardReconnectTimer = null;
    let lanyardPaused = false;
    let lanyardUserId = '';
    /** @type {Map<string, string>} */
    const resolvedGameImages = new Map();
    /** @param {number} typeId */
    const activityTypeLabel = (typeId) =>
      /** @type {Record<number, string>} */ ({
        0: t('type_playing'),
        1: t('type_streaming'),
        2: t('type_listening'),
        3: t('type_watching'),
        4: t('type_custom'),
        5: t('type_competing'),
      })[Number(typeId)] || t('type_activity');
    /** @param {number} ms */
    const formatElapsed = (ms) => {
      const total = Math.max(0, Math.floor(ms / 1000));
      const h = String(Math.floor(total / 3600)).padStart(2, '0');
      const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
      const sec = String(total % 60).padStart(2, '0');
      return `${h}:${m}:${sec}`;
    };
    /**
     * @param {number | null} startedAt
     * @param {number | null} endAt
     */
    function formatActivityElapsed(startedAt, endAt) {
      if (!startedAt) return '—';
      const now = Date.now();
      const startsSoon = startedAt > now && startedAt - now <= 600000;
      if (startsSoon) return t('starts_in', formatElapsed(startedAt - now));
      if (startedAt > now) return '—';
      if (endAt && now >= endAt) return t('ended');
      return `${t('elapsed')} ${formatElapsed(now - startedAt)}`;
    }

    function tickActivity() {
      const elapsed = document.getElementById('activity-elapsed');
      if (elapsed) elapsed.textContent = formatActivityElapsed(activityStartedAt, activityEndAt);
      const secondaryElapsed = document.getElementById('activity-secondary-elapsed');
      if (secondaryElapsed)
        secondaryElapsed.textContent = formatActivityElapsed(secondaryActivityStartedAt, secondaryActivityEndAt);
    }
    /** @param {ActivityView} j */
    function renderActivity(j) {
      const primary = j.primaryActivity;
      const user = j.user || {};
      const status = j.status || 'offline';
      const listeningActivity = Array.isArray(j.activities)
        ? j.activities.find((activity) => activity?.typeId === 2)
        : null;
      const spotify =
        j.spotify ||
        (listeningActivity
          ? {
              song: listeningActivity.details || listeningActivity.name || '',
              artist: listeningActivity.state || '',
              album: listeningActivity.largeText || '',
              albumArt: listeningActivity.largeImage || null,
              startedAt: listeningActivity.startedAt || null,
              endAt: listeningActivity.endAt || null,
            }
          : null);
      const primaryIsMusic = primary?.typeId === 2;
      const gameActivity = primaryIsMusic ? null : primary;
      const primaryMusic = primaryIsMusic
        ? spotify || {
            song: primary?.details || primary?.name || '',
            artist: primary?.state || '',
            album: '',
            albumArt: primary?.largeImage || null,
            startedAt: primary?.startedAt || null,
            endAt: primary?.endAt || null,
          }
        : null;
      const musicForMain = !gameActivity ? spotify || primaryMusic : null;
      // When a game and Spotify are active together, keep the game as the main
      // activity and render Spotify as a separate secondary activity.
      const musicForSecondary = spotify && gameActivity ? spotify : null;

      setText('activity-status', statusLabel(status));
      const typeId = Number(gameActivity?.typeId ?? primary?.typeId ?? -1);
      const activityTypeText = musicForMain
        ? t('type_listening')
        : typeId >= 0
          ? activityTypeLabel(typeId)
          : j.customStatus
            ? t('custom_status')
            : t('discord_presence');
      setText('activity-type', activityTypeText);

      // Match the Steam card hierarchy: the largest title is the account name,
      // with the current activity shown underneath.
      const displayName = user.displayName || user.username || user.handle || 'Discord';
      const mainActivityName = musicForMain
        ? musicForMain.song || t('music')
        : gameActivity?.name || (j.customStatus?.text ? j.customStatus.text : t('no_activity'));
      const mainState = musicForMain
        ? musicForMain.artist || ''
        : gameActivity?.details || gameActivity?.state || j.customStatus?.text || '';
      const mainDetail = musicForMain
        ? musicForMain.album || ''
        : gameActivity?.details && gameActivity?.state
          ? gameActivity.state
          : '';
      setText('activity-name', displayName);
      setText('activity-state', mainActivityName);
      setText('activity-detail', mainState || mainDetail);

      const custom = document.getElementById('activity-custom');
      if (custom) {
        const text = j.customStatus?.text
          ? `${j.customStatus?.emoji ? `${j.customStatus.emoji} ` : ''}${j.customStatus.text}`
          : '';
        custom.textContent = text;
        custom.hidden = !text;
      }
      const devices = document.getElementById('activity-devices');
      if (devices) {
        const list = [];
        if (j.desktop) list.push(t('device_desktop'));
        if (j.mobile) list.push(t('device_mobile'));
        if (j.web) list.push(t('device_web'));
        devices.textContent = list.length ? t('devices_on', list.join(' · ')) : '';
        devices.hidden = !list.length;
      }
      const discordLink = /** @type {HTMLAnchorElement | null} */ (document.getElementById('activity-discord-link'));
      if (discordLink && user.id) discordLink.href = `https://discord.com/users/${encodeURIComponent(user.id)}`;

      const img = /** @type {HTMLImageElement | null} */ (document.getElementById('activity-image'));
      const artWrap = /** @type {HTMLElement | null} */ (img?.closest('.activity-art-wrap') ?? null);
      if (gameActivity?.name && (gameActivity.largeImage || gameActivity.largeImageFallback)) {
        resolvedGameImages.set(
          gameActivity.name.trim().toLocaleLowerCase(),
          gameActivity.largeImage || gameActivity.largeImageFallback || '',
        );
      }
      const activityEl = document.getElementById('activity');
      const artBg = document.getElementById('art-bg');
      /** @param {string | null} url */
      const applyArt = (url) => {
        if (artBg) artBg.style.backgroundImage = url ? `url("${String(url).replace(/"/g, '\\"')}")` : '';
      };
      if (img) {
        const imageUrl = musicForMain?.albumArt || gameActivity?.largeImage || gameActivity?.largeImageFallback || null;
        const fallbackUrl = musicForMain?.albumArt || gameActivity?.largeImageFallback || null;
        const hasArt = Boolean(imageUrl);
        const overlay = /** @type {HTMLImageElement | null} */ (document.getElementById('activity-avatar'));
        const overlayEmpty = /** @type {HTMLImageElement | null} */ (document.getElementById('activity-avatar-empty'));
        const overlayUrl = user.avatar || '';
        if (overlay) {
          overlay.hidden = !hasArt || !overlayUrl;
          if (overlayUrl) overlay.src = overlayUrl;
        }
        if (overlayEmpty) {
          overlayEmpty.hidden = hasArt || !overlayUrl;
          if (overlayUrl) overlayEmpty.src = overlayUrl;
        }
        activityEl?.classList.toggle('no-art', !hasArt);
        if (artWrap) artWrap.hidden = !hasArt;
        const updateDiscordArtShape = () => {
          if (!img) return;
          const square =
            Number(img.naturalWidth || 0) > 0 &&
            Number(img.naturalHeight || 0) > 0 &&
            Math.abs(img.naturalWidth - img.naturalHeight) <= 2;
          img.classList.toggle('activity-art-square', square);
          img.classList.toggle('activity-art-landscape', !square);
          img.classList.toggle('activity-art-music', Boolean(musicForMain));
        };
        img.onload = updateDiscordArtShape;
        img.onerror = () => {
          if (fallbackUrl && img.src !== fallbackUrl) {
            img.src = fallbackUrl;
            return;
          }
          activityEl?.classList.add('no-art');
          if (artWrap) artWrap.hidden = true;
          const failedAvatar = /** @type {HTMLImageElement | null} */ (
            document.getElementById('activity-avatar-empty')
          );
          const failedAvatarUrl = user.avatar || '';
          if (failedAvatar) {
            failedAvatar.hidden = !failedAvatarUrl;
            if (failedAvatarUrl) failedAvatar.src = failedAvatarUrl;
          }
          const currentAvatar = document.getElementById('activity-avatar');
          if (currentAvatar) currentAvatar.hidden = true;
          img.classList.remove('activity-art-square', 'activity-art-landscape', 'activity-art-music');
          applyArt(null);
        };
        if (hasArt) {
          img.src = imageUrl || '';
          img.alt = musicForMain?.song || gameActivity?.largeText || gameActivity?.name || t('activity_image');
          applyArt(imageUrl);
          if (img.complete) updateDiscordArtShape();
        } else {
          img.classList.remove('activity-art-square', 'activity-art-landscape', 'activity-art-music');
          applyArt(null);
        }
      }

      const secondary = document.getElementById('activity-secondary');
      const secondaryImage = /** @type {HTMLImageElement | null} */ (
        document.getElementById('activity-secondary-image')
      );
      secondaryActivityStartedAt = null;
      secondaryActivityEndAt = null;
      const secondaryMusic = musicForSecondary;
      if (secondary) {
        secondary.hidden = !secondaryMusic;
        if (secondaryMusic) {
          setText('activity-secondary-type', t('type_listening'));
          setText('activity-secondary-name', secondaryMusic.song || t('music'));
          setText('activity-secondary-state', secondaryMusic.artist || '');
          setText('activity-secondary-detail', secondaryMusic.album || '');
          secondaryActivityStartedAt = Number(secondaryMusic.startedAt || 0) || null;
          secondaryActivityEndAt = Number(secondaryMusic.endAt || 0) || null;
          setText(
            'activity-secondary-elapsed',
            formatActivityElapsed(secondaryActivityStartedAt, secondaryActivityEndAt),
          );
          if (secondaryImage) {
            secondaryImage.hidden = !secondaryMusic.albumArt;
            secondaryImage.src = secondaryMusic.albumArt || '';
            secondaryImage.alt = secondaryMusic.song || t('music');
          }
        } else if (secondaryImage) {
          secondaryImage.hidden = true;
          secondaryImage.removeAttribute('src');
          secondaryActivityStartedAt = null;
          secondaryActivityEndAt = null;
        } else {
          secondaryActivityStartedAt = null;
          secondaryActivityEndAt = null;
        }
      }

      activityStartedAt = Number((musicForMain || gameActivity)?.startedAt || 0) || null;
      activityEndAt = Number((musicForMain || gameActivity)?.endAt || 0) || null;
      tickActivity();
      const buttons = document.getElementById('activity-buttons');
      const buttonSource = gameActivity || (primaryIsMusic ? primary : null);
      if (buttons)
        buttons.innerHTML = (buttonSource?.buttons || [])
          .filter(isActivityButton)
          .map(
            (button) =>
              `<a class="activity-btn" href="${escapeHtml(button.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(button.label)} <span class="fluent-icon" style="--fluent-icon-url:url(\"/icons/fluent/arrow_up_right_24_regular.svg\");width:16px;height:16px"></span></a>`,
          )
          .join('');
      const source = document.getElementById('activity-updated');
      if (source) source.textContent = `${t('presence_live')} · ${statusLabel(status)}`;
    }

    /** @param {string} kind */
    function renderUnavailable(kind) {
      const isDiscord = kind === 'discord';
      setText(isDiscord ? 'activity-status' : 'steam-status', t('unavailable'));
      setText(
        isDiscord ? 'activity-type' : 'steam-activity-type',
        isDiscord ? t('discord_presence') : t('steam_presence'),
      );
      setText(isDiscord ? 'activity-name' : 'steam-player-name', isDiscord ? 'Discord' : 'Steam');
      setText(isDiscord ? 'activity-state' : 'steam-game-name', '');
      setText(
        isDiscord ? 'activity-detail' : 'steam-game-detail',
        isDiscord ? t('lanyard_unavailable') : t('steam_api_unavailable'),
      );
      const root = document.getElementById(isDiscord ? 'activity' : 'steam-activity');
      root?.classList.add('no-art');
      const artWrap = /** @type {HTMLElement | null} */ (root?.querySelector('.activity-art-wrap') ?? null);
      if (artWrap) artWrap.hidden = true;
      const bg = document.getElementById(isDiscord ? 'art-bg' : 'steam-art-bg');
      if (bg) bg.style.backgroundImage = '';
      if (isDiscord) {
        activityStartedAt = null;
        activityEndAt = null;
        secondaryActivityStartedAt = null;
        secondaryActivityEndAt = null;
        setText('activity-elapsed', '—');
        setText('activity-secondary-elapsed', '—');
        const overlay = /** @type {HTMLImageElement | null} */ (document.getElementById('activity-avatar'));
        const overlayEmpty = /** @type {HTMLImageElement | null} */ (document.getElementById('activity-avatar-empty'));
        if (overlay) overlay.hidden = true;
        if (overlayEmpty) overlayEmpty.hidden = true;
        const buttons = document.getElementById('activity-buttons');
        if (buttons) buttons.innerHTML = '';
      } else {
        setText('steam-playtime', '—');
        const overlay = document.getElementById('steam-avatar-overlay');
        const overlayEmpty = document.getElementById('steam-avatar-empty');
        if (overlay) overlay.hidden = true;
        if (overlayEmpty) overlayEmpty.hidden = true;
        const recent = document.getElementById('steam-recent');
        if (recent) recent.hidden = true;
      }
    }

    async function loadActivity() {
      try {
        const r = await fetch('/api/activity', { cache: 'no-store' });
        if (!r.ok) {
          renderUnavailable('discord');
          return false;
        }
        const j = /** @type {any} */ (await r.json());
        if (!j.available) {
          renderUnavailable('discord');
          return false;
        }
        renderActivity(j);
        if (j.user?.id && j.user.id !== lanyardUserId) {
          lanyardUserId = j.user.id;
          connectLanyard(lanyardUserId);
        }
        return true;
      } catch {
        renderUnavailable('discord');
        return false;
      }
    }
    /** @param {string} userId */
    function connectLanyard(userId) {
      if (!userId || lanyardPaused) return;
      if (lanyardSocket) {
        const previous = lanyardSocket;
        lanyardSocket = null;
        try {
          previous.close();
        } catch {}
      }
      try {
        const socket = new WebSocket('wss://api.lanyard.rest/socket');
        lanyardSocket = socket;
        socket.addEventListener('open', () => {
          lanyardReconnectAttempts = 0;
        });
        socket.addEventListener('message', (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.op === 1) {
              clearInterval(lanyardHeartbeat ?? undefined);
              lanyardHeartbeat = setInterval(
                () => {
                  if (lanyardSocket && lanyardSocket.readyState === WebSocket.OPEN)
                    lanyardSocket.send(JSON.stringify({ op: 3 }));
                },
                Math.max(10000, Number(msg.d?.heartbeat_interval || 30000)),
              );
              if (lanyardSocket) lanyardSocket.send(JSON.stringify({ op: 2, d: { subscribe_to_id: userId } }));
            } else if (msg.op === 0 && (msg.t === 'INIT_STATE' || msg.t === 'PRESENCE_UPDATE')) {
              const presence = msg.d?.[userId] ?? msg.d;
              if (presence) renderActivity(presenceToView(presence));
            }
          } catch {}
        });
        socket.addEventListener('close', () => {
          clearInterval(lanyardHeartbeat ?? undefined);
          lanyardHeartbeat = null;
          // A close from a replaced/paused socket must not schedule another
          // reconnect (#7: no socket churn while the tab is hidden).
          if (lanyardPaused || lanyardSocket !== socket) return;
          lanyardSocket = null;
          // Capped exponential backoff (5s -> 10s -> 20s -> ... -> 60s max) instead of a
          // fixed 5s retry, so a down/unreachable Lanyard endpoint doesn't spam reconnect
          // attempts (and console errors) forever.
          lanyardReconnectAttempts += 1;
          const delay = Math.min(60000, 5000 * 2 ** (lanyardReconnectAttempts - 1));
          lanyardReconnectTimer = setTimeout(() => connectLanyard(userId), delay);
        });
        socket.addEventListener('error', () => socket.close());
      } catch {}
    }

    /** #7: stop the presence socket while the tab is hidden (no reconnects). */
    function pauseLanyard() {
      lanyardPaused = true;
      clearTimeout(lanyardReconnectTimer ?? undefined);
      lanyardReconnectTimer = null;
      clearInterval(lanyardHeartbeat ?? undefined);
      lanyardHeartbeat = null;
      const socket = lanyardSocket;
      lanyardSocket = null;
      if (socket) {
        try {
          socket.close();
        } catch {}
      }
    }

    /** #7: on visibility return, re-subscribe immediately if a user id is known. */
    function resumeLanyard() {
      lanyardPaused = false;
      if (!lanyardUserId) return;
      lanyardReconnectAttempts = 0;
      connectLanyard(lanyardUserId);
    }
    /**
     * @param {LanyardPresence} presence
     * @returns {ActivityView}
     */
    function presenceToView(presence) {
      const activities = Array.isArray(presence.activities) ? presence.activities : [];
      const custom = activities.find((a) => a.type === 4);
      const primary =
        activities.find((a) => [0, 1, 3, 5].includes(a.type ?? -1)) ??
        activities.find((a) => a.type !== 4 && a.type !== 2) ??
        activities.find((a) => a.type === 2) ??
        activities[0] ??
        null;
      /**
       * @param {string | null | undefined} asset
       * @param {string | undefined} appId
       * @returns {string | null}
       */
      const assetUrl = (asset, appId) => {
        if (!asset) return null;
        if (/^https?:\/\//i.test(asset)) return asset;
        if (asset.startsWith('mp:')) return `https://media.discordapp.net/${asset.slice(3)}`;
        if (asset.startsWith('spotify:')) return `https://i.scdn.co/image/${asset.slice(8)}`;
        return appId ? `https://cdn.discordapp.com/app-assets/${appId}/${asset}.png?size=512` : null;
      };
      /** @param {string | null | undefined} asset @returns {string | null} */
      const assetFallback = (asset) => {
        if (!asset || !asset.startsWith('mp:external/')) return null;
        const marker = '/https/';
        const idx = asset.indexOf(marker);
        return idx === -1 ? null : `https://${asset.slice(idx + marker.length)}`;
      };
      const rawLarge = primary?.assets?.large_image || '';
      const rawSmall = primary?.assets?.small_image || '';
      const directLargeImage = assetUrl(rawLarge, primary?.application_id) || primary?.assets?.large_url || null;
      const cachedGameImage =
        primary?.type === 0
          ? resolvedGameImages.get(
              String(primary?.name || '')
                .trim()
                .toLocaleLowerCase(),
            ) || null
          : null;
      const largeImage =
        directLargeImage || (primary?.type === 2 ? presence.spotify?.album_art_url || null : cachedGameImage);
      const largeImageFallback =
        assetFallback(rawLarge) ||
        cachedGameImage ||
        (primary?.type === 2 ? presence.spotify?.album_art_url || null : null);
      const smallImage = assetUrl(rawSmall, primary?.application_id);
      const buttons = Array.isArray(primary?.buttons)
        ? primary.buttons
            .filter((x) => typeof x === 'string')
            .map((x) => ({ label: x, url: '' }))
            .filter((x) => x.url)
        : [];
      const listening = activities.find((a) => a.type === 2) || null;
      const listeningAssets = listening?.assets || {};
      const spotifyView = presence.spotify
        ? {
            song: presence.spotify.song || '',
            artist: presence.spotify.artist || '',
            album: presence.spotify.album || '',
            albumArt: presence.spotify.album_art_url || null,
            startedAt: presence.spotify.timestamps?.start || null,
            endAt: presence.spotify.timestamps?.end || null,
          }
        : listening
          ? {
              song: listening.details || listening.name || '',
              artist: listening.state || '',
              album: listeningAssets.large_text || '',
              albumArt:
                assetUrl(listeningAssets.large_image, listening.application_id) ||
                listeningAssets.large_url ||
                assetFallback(listeningAssets.large_image) ||
                null,
              startedAt: listening.timestamps?.start || null,
              endAt: listening.timestamps?.end || null,
            }
          : null;
      const activityViews = activities.map((activity) => ({
        type: activity.type ?? 0,
        typeId: activity.type ?? 0,
        name: activity.name || '',
        details: activity.details || '',
        state: activity.state || '',
        largeImage:
          assetUrl(activity.assets?.large_image, activity.application_id) ||
          activity.assets?.large_url ||
          assetFallback(activity.assets?.large_image) ||
          (activity.type === 0
            ? resolvedGameImages.get(
                String(activity.name || '')
                  .trim()
                  .toLocaleLowerCase(),
              ) || null
            : null),
        largeText: activity.assets?.large_text || '',
        startedAt: activity.timestamps?.start || null,
        endAt: activity.timestamps?.end || null,
      }));
      return {
        available: true,
        user: {
          id: presence.discord_user?.id,
          displayName:
            presence.discord_user?.global_name ||
            presence.discord_user?.display_name ||
            presence.discord_user?.username ||
            'Discord',
          username: presence.discord_user?.username || '',
          handle: presence.discord_user?.username || '',
          avatar: presence.discord_user?.avatar
            ? `https://cdn.discordapp.com/avatars/${presence.discord_user.id}/${presence.discord_user.avatar}.${presence.discord_user.avatar.startsWith('a_') ? 'gif' : 'png'}?size=128`
            : null,
        },
        status: presence.discord_status,
        statusLabel: statusLabel(presence.discord_status) || presence.discord_status,
        customStatus: custom ? { text: custom.state || '', emoji: custom.emoji?.name || null } : null,
        primaryActivity: primary
          ? {
              type: activityTypeLabel(primary.type ?? -1),
              typeId: primary.type ?? 0,
              name: primary.name || '',
              details: primary.details || '',
              state: primary.state || '',
              largeImage,
              largeImageFallback,
              largeText: primary.assets?.large_text || '',
              smallImage,
              smallText: primary.assets?.small_text || '',
              startedAt: primary.timestamps?.start || null,
              endAt: primary.timestamps?.end || null,
              buttons,
            }
          : null,
        activities: activityViews,
        spotify: spotifyView,
        desktop: presence.active_on_discord_desktop,
        mobile: presence.active_on_discord_mobile,
        web: presence.active_on_discord_web,
      };
    }

    async function loadSteam() {
      try {
        const r = await fetch('/api/steam', { cache: 'no-store' });
        if (!r.ok) return false;
        const j = /** @type {any} */ (await r.json());
        if (!j.configured) {
          renderUnavailable('steam');
          return true;
        }
        const profile = j.profile || {};
        const online = j.playing || (profile.personastate || 0) > 0;
        setText('steam-status', j.playing ? t('playing_now') : online ? t('in_game') : t('not_online'));
        setText('steam-activity-type', j.playing ? t('type_playing') : t('steam_presence'));
        setText('steam-player-name', profile.personaname || 'Steam');
        setText(
          'steam-game-name',
          j.playing
            ? profile.gameextrainfo
            : j.presenceLabel === 'online'
              ? t('in_game')
              : j.presenceLabel === 'offline'
                ? t('not_online')
                : t('no_game'),
        );
        const forever = Number(j.playtimeForeverMinutes || 0);
        const twoWeeks = Number(j.playtime2WeeksMinutes || 0);
        setText(
          'steam-game-detail',
          j.playing ? t('game_playing', profile.gameextrainfo) : t('currently_playing_none'),
        );
        const playtimeEl = document.getElementById('steam-playtime');
        if (playtimeEl) {
          const parts = [];
          if (forever > 0) parts.push(t('playtime_total', (forever / 60).toFixed(1)));
          if (twoWeeks > 0) parts.push(t('playtime_2w', (twoWeeks / 60).toFixed(1)));
          playtimeEl.textContent = j.playing && parts.length ? parts.join(' · ') : '—';
        }
        const art = /** @type {HTMLImageElement | null} */ (document.getElementById('steam-game-image'));
        const steamRoot = document.getElementById('steam-activity');
        const hasSteamArt = Boolean(j.playing && j.gameImage);
        steamRoot?.classList.toggle('no-art', !hasSteamArt);
        const steamWrap = /** @type {HTMLElement | null} */ (art?.closest('.activity-art-wrap') ?? null);
        if (steamWrap) steamWrap.hidden = !hasSteamArt;
        if (art && hasSteamArt) art.src = j.gameImage;
        const steamBg = document.getElementById('steam-art-bg');
        if (steamBg)
          steamBg.style.backgroundImage = hasSteamArt ? `url("${String(j.gameImage).replace(/"/g, '\\"')}")` : '';
        const avatarOverlay = /** @type {HTMLImageElement | null} */ (document.getElementById('steam-avatar-overlay'));
        const steamAvatarSmall = profile.avatarmedium || profile.avatarfull;
        const avatarEmpty = /** @type {HTMLImageElement | null} */ (document.getElementById('steam-avatar-empty'));
        if (avatarOverlay) {
          if (steamAvatarSmall) {
            avatarOverlay.src = steamAvatarSmall;
            avatarOverlay.hidden = !hasSteamArt;
          } else avatarOverlay.hidden = true;
        }
        if (avatarEmpty) {
          if (steamAvatarSmall) {
            avatarEmpty.src = steamAvatarSmall;
            avatarEmpty.hidden = hasSteamArt ? true : false;
          } else avatarEmpty.hidden = true;
        }
        const link = /** @type {HTMLAnchorElement | null} */ (document.getElementById('steam-profile-link'));
        if (link && profile.profileurl) link.href = profile.profileurl;

        const recentWrap = document.getElementById('steam-recent');
        const recentList = document.getElementById('steam-recent-list');
        if (recentWrap && recentList) {
          const recent = /** @type {SteamGame[]} */ (
            Array.isArray(j.recentlyPlayed) ? j.recentlyPlayed.slice(0, 3) : []
          );
          if (recent.length) {
            recentList.innerHTML = recent
              .map((game) => {
                const hrs = (Number(game.playtime2WeeksMinutes || 0) / 60).toFixed(1);
                const icon = game.iconUrl ? `<img src="${escapeHtml(game.iconUrl)}" alt="" loading="lazy" />` : '';
                return `<div class="steam-recent-item">${icon}<span class="steam-recent-name">${escapeHtml(game.name || '')}</span><span class="steam-recent-hrs">${escapeHtml(t('hrs_short', hrs))}</span></div>`;
              })
              .join('');
            recentWrap.hidden = false;
          } else {
            recentWrap.hidden = true;
          }
        }
      } catch {
        renderUnavailable('steam');
        return false;
      }
      return true;
    }

    async function loadHomepageServices() {
      try {
        const r = await fetch('/api/status', { cache: 'no-store' });
        if (!r.ok) return false;
        const j = /** @type {any} */ (await r.json());
        const services = /** @type {ServiceStatus[]} */ (j.services || []);
        const map = new Map(services.map((service) => [service.key, service]));
        document.querySelectorAll('#homepage-services .service').forEach((row) => {
          const key = row.getAttribute('data-home-service') || '';
          const result = map.get(key);
          const status = row.querySelector('.service-status');
          if (!result || !status) return;
          const good = result.ok;
          status.className = `service-status ${good ? 'good' : 'bad'}`;
          status.innerHTML = `<span class="pulse"></span>${good ? t('normal') : t('abnormal')}`;
        });
        const badge = document.getElementById('homepage-status-badge');
        if (badge) {
          badge.className = `social-status-badge ${j.ok ? 'status-online' : 'status-offline'}`;
          badge.innerHTML = `<span class="pulse"></span>${j.ok ? t('all_normal') : t('some_error')}`;
        }
        return true;
      } catch {
        document.querySelectorAll('#homepage-services .service-status').forEach((status) => {
          status.className = 'service-status bad';
          status.innerHTML = `<span class="pulse"></span>${t('unavailable')}`;
        });
        const badge = document.getElementById('homepage-status-badge');
        if (badge) {
          badge.className = 'social-status-badge status-offline';
          badge.innerHTML = `<span class="pulse"></span>${t('some_error')}`;
        }
        return false;
      }
    }

    // --- Polling: visibility pause, immediate catch-up and capped backoff (#7) ---

    const POLL_MAX_BACKOFF_MS = 5 * 60 * 1000;

    /**
     * One endpoint's poll loop.
     *
     * `task` resolves to `false` for a failed request (or throws); anything else
     * counts as success. The cadence is the endpoint's interval on success and
     * doubles for every consecutive failure, capped at five minutes.
     */
    /**
     * @param {() => Promise<unknown>} task
     * @param {number} intervalMs
     */
    function createPoller(task, intervalMs) {
      /** @type {number | null} */
      let timer = null;
      let failures = 0;
      let stopped = false;
      let running = false;
      let refreshQueued = false;

      /** @param {number} delay */
      const schedule = (delay) => {
        if (stopped || document.hidden) return;
        timer = setTimeout(run, delay);
      };

      async function run() {
        timer = null;
        if (stopped || document.hidden) return;
        if (running) {
          refreshQueued = true;
          return;
        }
        running = true;
        let ok = false;
        try {
          ok = (await task()) !== false;
        } catch {
          ok = false;
        } finally {
          running = false;
        }
        if (stopped) return;
        if (refreshQueued) {
          refreshQueued = false;
          void run();
          return;
        }
        failures = ok ? 0 : failures + 1;
        schedule(ok ? intervalMs : Math.min(POLL_MAX_BACKOFF_MS, intervalMs * 2 ** Math.min(failures, 10)));
      }

      return {
        start() {
          schedule(intervalMs);
        },
        /** Run now (e.g. after a language change) and restart the cadence. */
        refresh() {
          if (stopped) return;
          if (timer !== null) {
            clearTimeout(timer ?? undefined);
            timer = null;
          }
          void run();
        },
        pause() {
          if (timer !== null) {
            clearTimeout(timer ?? undefined);
            timer = null;
          }
        },
        stop() {
          stopped = true;
          if (timer !== null) {
            clearTimeout(timer ?? undefined);
            timer = null;
          }
        },
      };
    }

    const pollers = [
      createPoller(loadActivity, 10000),
      createPoller(loadSteam, 60000),
      createPoller(loadVisitors, 60000),
      createPoller(loadHomepageServices, 30000),
    ];

    function startActivityTicker() {
      if (activityInterval === null) activityInterval = setInterval(tickActivity, 1000);
    }
    function stopActivityTicker() {
      if (activityInterval !== null) {
        clearInterval(activityInterval ?? undefined);
        activityInterval = null;
      }
    }

    function onVisibilityChange() {
      if (document.hidden) {
        pollers.forEach((poller) => poller.pause());
        stopActivityTicker();
        pauseLanyard();
        return;
      }
      // Back in the tab: refresh every panel once, then resume the normal
      // cadence; the presence socket re-subscribes immediately too.
      startActivityTicker();
      resumeLanyard();
      pollers.forEach((poller) => poller.refresh());
    }

    loadVisitors();
    loadActivity();
    loadSteam();
    loadHomepageServices();
    startActivityTicker();
    pollers.forEach((poller) => poller.start());
    document.addEventListener('visibilitychange', onVisibilityChange);

    const onLang = () => {
      pollers.forEach((poller) => poller.refresh());
    };
    window.addEventListener('bm:lang', onLang);

    // Let the next navigation's run of this script tear this run down first.
    // The visit beacon and its Turnstile widget are not part of this run: they
    // live in public/scripts/visit-beacon.js, are loaded once per full page load
    // and are not re-initialised by swup, so there is no dashboard-owned widget
    // to clean up here.
    window.__bmHomeCleanup = () => {
      pollers.forEach((poller) => poller.stop());
      stopActivityTicker();
      pauseLanyard();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('bm:lang', onLang);
    };
  })();
}
