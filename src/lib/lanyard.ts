export const LANYARD_API = 'https://api.lanyard.rest/v1/users';

export type LanyardButton = { label?: string; url?: string };
export type LanyardActivity = {
  id?: string;
  name?: string;
  type?: number;
  url?: string | null;
  details?: string | null;
  state?: string | null;
  application_id?: string | null;
  created_at?: number | null;
  timestamps?: { start?: number; end?: number };
  assets?: {
    large_image?: string;
    large_text?: string;
    large_url?: string;
    small_image?: string;
    small_text?: string;
    small_url?: string;
  };
  buttons?: string[] | LanyardButton[];
  emoji?: { name?: string; id?: string | null; animated?: boolean } | null;
  sync_id?: string;
};

export type LanyardPresence = {
  active_on_discord_mobile: boolean;
  active_on_discord_desktop: boolean;
  active_on_discord_web: boolean;
  listening_to_spotify: boolean;
  discord_status: 'online' | 'idle' | 'dnd' | 'offline' | string;
  discord_user: {
    id: string;
    username?: string;
    global_name?: string | null;
    display_name?: string | null;
    avatar?: string | null;
    discriminator?: string;
  };
  activities: LanyardActivity[];
  spotify?: {
    track_id?: string;
    timestamps?: { start?: number; end?: number };
    song?: string;
    artist?: string;
    album?: string;
    album_art_url?: string;
  } | null;
  kv?: Record<string, string>;
};

export function discordAssetUrl(
  applicationId: string | null | undefined,
  asset: string | null | undefined,
): string | null {
  if (!asset) return null;
  if (/^https?:\/\//i.test(asset)) return asset;
  if (asset.startsWith('mp:')) return `https://media.discordapp.net/${asset.slice(3)}`;
  if (asset.startsWith('spotify:')) return `https://i.scdn.co/image/${asset.slice(8)}`;
  if (asset.startsWith('twitch:') || asset.startsWith('youtube:')) return null;
  if (applicationId) return `https://cdn.discordapp.com/app-assets/${applicationId}/${asset}.png?size=512`;
  return null;
}

export function discordAssetFallback(asset: string | null | undefined): string | null {
  if (!asset || !asset.startsWith('mp:external/')) return null;
  const marker = '/https/';
  const index = asset.indexOf(marker);
  if (index === -1) return null;
  return `https://${asset.slice(index + marker.length)}`;
}

export function discordAvatarUrl(userId: string, avatar: string | null | undefined): string | null {
  if (!avatar) return null;
  return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.${avatar.startsWith('a_') ? 'gif' : 'png'}?size=128`;
}

export async function fetchLanyardPresence(userId: string, signal?: AbortSignal): Promise<LanyardPresence | null> {
  if (!userId) return null;
  const response = await fetch(`${LANYARD_API}/${encodeURIComponent(userId)}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
    signal,
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { success?: boolean; data?: LanyardPresence };
  return payload.success && payload.data ? payload.data : null;
}
