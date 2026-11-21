import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { pickSteamProfile, steamPresenceLabel } from '../../lib/steam-core';

export const GET: APIRoute = async () => {
  const key = env.STEAM_API_KEY;
  const id = env.STEAM_ID;
  if (!key || !id) return Response.json({ configured: false }, { headers: { 'cache-control': 'no-store' } });

  const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${encodeURIComponent(key)}&steamids=${encodeURIComponent(id)}`;
  try {
    const response = await fetch(url, { cf: { cacheTtl: 60, cacheEverything: true } });
    if (!response.ok) return Response.json({ configured: true, error: 'Steam API request failed' }, { status: 502 });
    const json = (await response.json()) as { response?: { players?: unknown[] } };
    const rawProfile = json.response?.players?.[0];

    // #15: only the fields the UI renders are forwarded. `gameid` is read from
    // the raw Steam object below for the server-side artwork/playtime lookups,
    // but it is not part of the response.
    const profile = pickSteamProfile(rawProfile);
    if (!profile)
      return Response.json({ configured: true, profile: null }, { headers: { 'cache-control': 'public,max-age=30' } });

    const gameId =
      typeof (rawProfile as { gameid?: unknown }).gameid === 'string'
        ? (rawProfile as { gameid: string }).gameid
        : null;

    let gameImage: string | null = null;
    let playtimeForeverMinutes: number | null = null;
    let playtime2WeeksMinutes: number | null = null;
    if (gameId) {
      try {
        const storeResponse = await fetch(
          `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(gameId)}`,
          {
            cf: { cacheTtl: 300, cacheEverything: true },
          },
        );
        if (storeResponse.ok) {
          const store = (await storeResponse.json()) as Record<
            string,
            { data?: { header_image?: string } } | undefined
          >;
          gameImage = store?.[gameId]?.data?.header_image ?? null;
        }
      } catch {
        // Steam profile data remains useful without artwork.
      }

      try {
        const ownedUrl = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${encodeURIComponent(key)}&steamid=${encodeURIComponent(id)}&include_appinfo=0&include_played_free_games=1&appids_filter[0]=${encodeURIComponent(gameId)}`;
        const ownedResponse = await fetch(ownedUrl, { cf: { cacheTtl: 120, cacheEverything: true } });
        if (ownedResponse.ok) {
          const owned = (await ownedResponse.json()) as {
            response?: { games?: Array<{ playtime_forever?: number; playtime_2weeks?: number }> };
          };
          const game = owned?.response?.games?.[0];
          if (game) {
            playtimeForeverMinutes = Number(game.playtime_forever) || 0;
            playtime2WeeksMinutes = Number(game.playtime_2weeks) || 0;
          }
        }
      } catch {
        // Playtime is a nice-to-have; ignore failures.
      }
    }

    let recentlyPlayed: Array<{
      appid: number;
      name: string;
      iconUrl: string | null;
      playtimeForeverMinutes: number;
      playtime2WeeksMinutes: number;
    }> = [];
    try {
      const recentUrl = `https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v0001/?key=${encodeURIComponent(key)}&steamid=${encodeURIComponent(id)}&count=5`;
      const recentResponse = await fetch(recentUrl, { cf: { cacheTtl: 300, cacheEverything: true } });
      if (recentResponse.ok) {
        const recent = (await recentResponse.json()) as {
          response?: {
            games?: Array<{
              appid: number;
              name?: string;
              img_icon_url?: string;
              playtime_forever?: number;
              playtime_2weeks?: number;
            }>;
          };
        };
        recentlyPlayed = (recent?.response?.games || []).map((game) => ({
          appid: Number(game.appid),
          name: String(game.name || ''),
          iconUrl: game.img_icon_url
            ? `https://media.steampowered.com/steamcommunity/public/images/apps/${game.appid}/${game.img_icon_url}.jpg`
            : null,
          playtimeForeverMinutes: Number(game.playtime_forever) || 0,
          playtime2WeeksMinutes: Number(game.playtime_2weeks) || 0,
        }));
      }
    } catch {
      // Recently-played is a nice-to-have; ignore failures.
    }

    return Response.json(
      {
        configured: true,
        profile,
        presenceLabel: steamPresenceLabel(profile.personastate),
        gameImage,
        playing: Boolean(profile.gameextrainfo),
        playtimeForeverMinutes,
        playtime2WeeksMinutes,
        recentlyPlayed,
      },
      { headers: { 'cache-control': 'public,max-age=60' } },
    );
  } catch {
    return Response.json({ configured: true, error: 'Steam API unavailable' }, { status: 502 });
  }
};
