import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { cachedJson } from '../../lib/cached-json';
import {
  discordAssetFallback,
  discordAssetUrl,
  discordAvatarUrl,
  fetchLanyardPresence,
  type LanyardActivity,
} from '../../lib/lanyard';

/** The homepage activity panel polls every 10 s; the cache matches that cadence. */
const ACTIVITY_CACHE_TTL_SECONDS = 10;

function activityTypeCode(type = 0): string {
  return (
    (
      { 0: 'playing', 1: 'streaming', 2: 'listening', 3: 'watching', 4: 'custom', 5: 'competing' } as Record<
        number,
        string
      >
    )[type] ?? 'activity'
  );
}

/** A presence Lanyard answered for, but without usable data (not a transport error). */
class PresenceUnavailableError extends Error {}

async function resolveSteamGameImage(name: string, signal?: AbortSignal): Promise<string | null> {
  const query = name.trim();
  if (!query) return null;
  try {
    const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=schinese&cc=cn`;
    const searchResponse = await fetch(searchUrl, {
      headers: { accept: 'application/json' },
      signal,
    });
    if (!searchResponse.ok) return null;
    const search = (await searchResponse.json()) as { items?: Array<{ id?: number; name?: string }> };
    const items = Array.isArray(search.items) ? search.items : [];
    if (!items.length) return null;
    const normalized = query.toLocaleLowerCase();
    const exact = items.find(
      (item) =>
        String(item.name || '')
          .trim()
          .toLocaleLowerCase() === normalized,
    );
    const appId = Number((exact ?? items[0]).id || 0);
    if (!appId) return null;

    const detailsResponse = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=schinese`, {
      headers: { accept: 'application/json' },
      signal,
    });
    if (!detailsResponse.ok) return null;
    const details = (await detailsResponse.json()) as Record<
      string,
      { success?: boolean; data?: { header_image?: string } }
    >;
    return details[String(appId)]?.success ? details[String(appId)]?.data?.header_image || null : null;
  } catch {
    return null;
  }
}

function normalizeButtons(value: LanyardActivity['buttons']): { label: string; url: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) =>
      typeof item === 'string'
        ? { label: item, url: '' }
        : { label: String(item?.label ?? ''), url: String(item?.url ?? '') },
    )
    .filter((item) => item.label && /^https?:\/\//i.test(item.url))
    .slice(0, 2);
}

/**
 * Build the public activity payload.
 *
 * Request-independent on purpose: it is the value `/api/activity` caches for
 * `ACTIVITY_CACHE_TTL_SECONDS` (#7). Anything per-request (here only
 * `fetchedAt`) is added by `cachedJson`'s `decorate`, outside the cache.
 */
async function buildActivityPayload(userId: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const presence = await fetchLanyardPresence(userId, controller.signal);
    if (!presence) {
      throw new PresenceUnavailableError(
        'Lanyard did not return a presence. Make sure the Discord user is being monitored by Lanyard.',
      );
    }

    const activities = Array.isArray(presence.activities) ? presence.activities : [];
    const custom = activities.find((activity) => activity.type === 4);
    // Prefer a game/stream/watch/competing activity when multiple activities exist.
    // Discord music is represented separately by Lanyard's `spotify` field, while
    // a listening activity may also appear in `activities`.
    const primary =
      activities.find((activity) => [0, 1, 3, 5].includes(activity.type ?? -1)) ??
      activities.find((activity) => activity.type !== 4 && activity.type !== 2) ??
      activities.find((activity) => activity.type === 2) ??
      activities[0] ??
      null;
    const assets = primary?.assets ?? {};
    const musicActivity = activities.find((activity) => activity.type === 2) ?? null;
    const musicAssets = musicActivity?.assets ?? {};
    const directLargeImage =
      discordAssetUrl(primary?.application_id, assets.large_image) ??
      assets.large_url ??
      (primary?.type === 2 ? presence.spotify?.album_art_url : null) ??
      null;
    const steamLookupController = primary?.type === 0 && !directLargeImage ? new AbortController() : null;
    const steamLookupTimeout = steamLookupController ? setTimeout(() => steamLookupController.abort(), 2500) : null;
    const steamGameImage =
      primary?.type === 0 && !directLargeImage
        ? await resolveSteamGameImage(primary.name || '', steamLookupController?.signal)
        : null;
    if (steamLookupTimeout) clearTimeout(steamLookupTimeout);
    const largeImage = directLargeImage ?? steamGameImage;
    const largeImageFallback = discordAssetFallback(assets.large_image) ?? steamGameImage ?? null;
    const smallImage = discordAssetUrl(primary?.application_id, assets.small_image);
    const spotify = presence.spotify
      ? {
          song: presence.spotify.song || '',
          artist: presence.spotify.artist || '',
          album: presence.spotify.album || '',
          albumArt: presence.spotify.album_art_url || null,
          startedAt: presence.spotify.timestamps?.start || null,
          endAt: presence.spotify.timestamps?.end || null,
        }
      : musicActivity
        ? {
            song: musicActivity.details || musicActivity.name || '',
            artist: musicActivity.state || '',
            album: musicAssets.large_text || '',
            albumArt:
              discordAssetUrl(musicActivity.application_id, musicAssets.large_image) ??
              musicAssets.large_url ??
              discordAssetFallback(musicAssets.large_image) ??
              null,
            startedAt: musicActivity.timestamps?.start || null,
            endAt: musicActivity.timestamps?.end || null,
          }
        : null;

    return {
      configured: true,
      available: true,
      user: {
        id: presence.discord_user.id,
        // Keep Discord API fields semantically correct: `username` is the actual
        // Discord username/handle, while `displayName` is used for the Steam-like
        // primary title when a Discord global display name is available.
        displayName:
          presence.discord_user.global_name ||
          presence.discord_user.display_name ||
          presence.discord_user.username ||
          'Discord User',
        username: presence.discord_user.username || '',
        handle: presence.discord_user.username || '',
        avatar: discordAvatarUrl(presence.discord_user.id, presence.discord_user.avatar),
      },
      status: presence.discord_status,
      statusLabel: presence.discord_status,
      statusCode: presence.discord_status,
      desktop: presence.active_on_discord_desktop,
      mobile: presence.active_on_discord_mobile,
      web: presence.active_on_discord_web,
      customStatus: custom
        ? {
            text: custom.state || '',
            emoji: custom.emoji?.name || null,
            createdAt: custom.created_at || null,
          }
        : null,
      primaryActivity: primary
        ? {
            type: activityTypeCode(primary.type),
            typeId: primary.type ?? 0,
            name: primary.name || '',
            details: primary.details || '',
            state: primary.state || '',
            applicationId: primary.application_id || null,
            largeImage,
            largeImageFallback,
            largeText: assets.large_text || '',
            largeUrl: assets.large_url || '',
            smallImage,
            smallText: assets.small_text || '',
            smallUrl: assets.small_url || '',
            startedAt: primary.timestamps?.start || null,
            endAt: primary.timestamps?.end || null,
            buttons: normalizeButtons(primary.buttons),
          }
        : null,
      activities: activities.map((activity) => ({
        type: activityTypeCode(activity.type),
        typeId: activity.type ?? 0,
        name: activity.name || '',
        details: activity.details || '',
        state: activity.state || '',
        applicationId: activity.application_id || null,
        largeImage:
          discordAssetUrl(activity.application_id, activity.assets?.large_image) ??
          activity.assets?.large_url ??
          discordAssetFallback(activity.assets?.large_image) ??
          null,
        startedAt: activity.timestamps?.start || null,
        endAt: activity.timestamps?.end || null,
      })),
      spotify,
      source: 'Lanyard',
      sourceUrl: 'https://github.com/Phineas/lanyard',
      /** Added per request by `decorate` below, never cached. */
      fetchedAt: undefined as number | undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const GET: APIRoute = async ({ request, locals }) => {
  const userId = env.DISCORD_USER_ID;
  if (!userId) {
    return Response.json(
      { configured: false, error: 'DISCORD_USER_ID is not configured' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  const executionContext = (locals as unknown as { cfContext?: ExecutionContext } | undefined)?.cfContext;

  try {
    return await cachedJson(request, ACTIVITY_CACHE_TTL_SECONDS, () => buildActivityPayload(userId), {
      // `fetchedAt` is per-request, so it is merged outside the shared cache.
      decorate: (value) => ({ ...value, fetchedAt: Date.now() }),
      ...(executionContext ? { waitUntil: (promise: Promise<unknown>) => executionContext.waitUntil(promise) } : {}),
    });
  } catch (error) {
    const message =
      error instanceof DOMException && error.name === 'AbortError'
        ? 'Lanyard request timed out'
        : error instanceof PresenceUnavailableError
          ? error.message
          : 'Lanyard request failed';
    return Response.json(
      { configured: true, available: false, error: message },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    );
  }
};

export const POST: APIRoute = async () =>
  Response.json(
    { error: 'Activity is now sourced from Lanyard. POST is disabled.' },
    { status: 405, headers: { allow: 'GET', 'cache-control': 'no-store' } },
  );
