import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STEAM_PROFILE_FIELDS, pickSteamProfile, steamPresenceLabel } from '../src/lib/steam-core.ts';

// A realistic Steam GetPlayerSummaries player object: it contains many fields
// the homepage dashboard never renders.
const RAW_PLAYER = {
  steamid: '76561198000000000',
  communityvisibilitystate: 3,
  profilestate: 1,
  personaname: 'Your Name',
  commentpermission: 1,
  profileurl: 'https://steamcommunity.com/id/yourname/',
  avatar: 'https://avatars.steamstatic.com/aaa_avatar.jpg',
  avatarmedium: 'https://avatars.steamstatic.com/aaa_medium.jpg',
  avatarfull: 'https://avatars.steamstatic.com/aaa_full.jpg',
  avatarhash: 'aaa',
  lastlogoff: 1_700_000_000,
  personastate: 1,
  realname: 'Private Name',
  primaryclanid: '103582791400000000',
  timecreated: 1_500_000_000,
  personastateflags: 0,
  loccountrycode: 'HK',
  gameextrainfo: 'Elden Ring',
  gameid: '1245620',
};

describe('pickSteamProfile (#15)', () => {
  it('returns exactly the whitelisted fields and nothing else', () => {
    const profile = pickSteamProfile(RAW_PLAYER);
    assert.ok(profile, 'a valid player object must produce a profile');
    assert.deepEqual(Object.keys(profile).sort(), [...STEAM_PROFILE_FIELDS].sort());
  });

  it('drops fields the dashboard does not render', () => {
    const profile = pickSteamProfile(RAW_PLAYER);
    assert.ok(profile);
    for (const field of ['avatar', 'gameid', 'lastlogoff', 'realname', 'loccountrycode', 'timecreated', 'steamid']) {
      assert.equal(field in profile, false, `${field} must not be forwarded`);
    }
  });

  it('keeps the values the dashboard reads', () => {
    assert.deepEqual(pickSteamProfile(RAW_PLAYER), {
      personaname: 'Your Name',
      avatarmedium: 'https://avatars.steamstatic.com/aaa_medium.jpg',
      avatarfull: 'https://avatars.steamstatic.com/aaa_full.jpg',
      profileurl: 'https://steamcommunity.com/id/yourname/',
      personastate: 1,
      gameextrainfo: 'Elden Ring',
    });
  });

  it('omits gameextrainfo when Steam does not report one', () => {
    const profile = pickSteamProfile({ ...RAW_PLAYER, gameextrainfo: undefined, gameid: undefined });
    assert.ok(profile);
    assert.equal('gameextrainfo' in profile, false);
    assert.deepEqual(
      Object.keys(profile).sort(),
      STEAM_PROFILE_FIELDS.filter((field) => field !== 'gameextrainfo').sort(),
    );
  });

  it('treats an empty gameextrainfo as not playing', () => {
    const profile = pickSteamProfile({ ...RAW_PLAYER, gameextrainfo: '' });
    assert.ok(profile);
    assert.equal('gameextrainfo' in profile, false);
  });

  it('defaults missing or malformed values instead of throwing', () => {
    const profile = pickSteamProfile({ personaname: 42, personastate: 'online' });
    assert.deepEqual(profile, {
      personaname: '',
      avatarmedium: '',
      avatarfull: '',
      profileurl: '',
      personastate: 0,
    });
  });

  it('returns null for non-object input', () => {
    for (const value of [null, undefined, 'player', 42, []]) {
      assert.equal(pickSteamProfile(value), null, String(value));
    }
  });
});

describe('steamPresenceLabel', () => {
  it('maps known persona states', () => {
    assert.equal(steamPresenceLabel(0), 'offline');
    assert.equal(steamPresenceLabel(1), 'online');
    assert.equal(steamPresenceLabel(6), 'looking_to_play');
  });

  it('falls back to unknown for out-of-range or malformed values', () => {
    assert.equal(steamPresenceLabel(9), 'unknown');
    assert.equal(steamPresenceLabel(-1), 'unknown');
    assert.equal(steamPresenceLabel('online'), 'unknown');
    assert.equal(steamPresenceLabel(Number.NaN), 'unknown');
  });
});
