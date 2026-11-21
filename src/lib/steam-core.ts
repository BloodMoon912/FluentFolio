// Pure helpers for `GET /api/steam` (#15).
//
// The endpoint used to forward Steam's whole player object to the browser. It
// now whitelists exactly the fields the homepage dashboard renders, verified by
// grepping `public/scripts/home-dashboard.js`: `personaname`, `avatarmedium`,
// `avatarfull`, `profileurl`, `personastate` and `gameextrainfo`. Steam also
// returns `realname`, `avatar`, `gameid`, `lastlogoff`, `timecreated`, … — none
// of which the UI uses, so they never leave the Worker.

import type { SteamProfile } from './types.ts';

/** The complete allow-list of Steam player fields returned to the browser. */
export const STEAM_PROFILE_FIELDS = [
  'personaname',
  'avatarmedium',
  'avatarfull',
  'profileurl',
  'personastate',
  'gameextrainfo',
] as const;

const PRESENCE_LABELS = ['offline', 'online', 'busy', 'away', 'snooze', 'looking_to_trade', 'looking_to_play'];

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Whitelist one Steam `GetPlayerSummaries` player object; null for non-objects. */
export function pickSteamProfile(value: unknown): SteamProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  const profile: SteamProfile = {
    personaname: asText(raw.personaname),
    avatarmedium: asText(raw.avatarmedium),
    avatarfull: asText(raw.avatarfull),
    profileurl: asText(raw.profileurl),
    personastate: asNumber(raw.personastate),
  };

  const game = asText(raw.gameextrainfo);
  if (game) profile.gameextrainfo = game;

  return profile;
}

/** Map Steam's numeric persona state to the code the dashboard expects. */
export function steamPresenceLabel(personastate: unknown): string {
  if (typeof personastate !== 'number' || !Number.isInteger(personastate)) return 'unknown';
  return PRESENCE_LABELS[personastate] ?? 'unknown';
}
