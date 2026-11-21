export type ActivityButton = {
  label: string;
  url: string;
};

export type Activity = {
  type: string;
  name: string;
  details?: string | null;
  state?: string | null;
  largeImage?: string | null;
  largeText?: string | null;
  smallImage?: string | null;
  smallText?: string | null;
  buttons?: ActivityButton[];
  startedAt?: number | null;
  updatedAt?: string | null;
};

/**
 * Only the fields the homepage Steam panel actually renders. `GET /api/steam`
 * whitelists exactly these (see src/lib/steam-core.ts); Steam's other player
 * fields (avatar, gameid, lastlogoff, realname, …) are never forwarded.
 */
export type SteamProfile = {
  personaname: string;
  avatarmedium: string;
  avatarfull: string;
  profileurl: string;
  personastate: number;
  gameextrainfo?: string;
};
