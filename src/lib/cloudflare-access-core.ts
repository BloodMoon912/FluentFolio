/**
 * Cloudflare Access JWT verification using Web Crypto (Workers-compatible).
 * Only RS256 Access application tokens are accepted. Merely receiving the
 * CF-Access-Jwt-Assertion header is never considered authentication.
 */

export interface AccessJwtEnvironment {
  ACCESS_TEAM_DOMAIN?: string;
  /** Shared AUD when one Access Application protects both admin pages and API. */
  ACCESS_AUD?: string;
  /** Route-specific AUDs when pages and API are protected by separate Access Applications. */
  ACCESS_ADMIN_AUD?: string;
  ACCESS_API_AUD?: string;
}

interface AccessJwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

interface AccessJwtPayload {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  email?: string;
  sub?: string;
}

interface JwkSet {
  keys?: JsonWebKey[];
}

interface CachedKeys {
  issuer: string;
  expiresAt: number;
  keys: Map<string, CryptoKey>;
}

const CLOCK_SKEW_SECONDS = 60;
const JWKS_CACHE_MS = 5 * 60 * 1000;
const MAX_JWT_LENGTH = 16_384;
/**
 * Minimum wait between two *forced* JWKS fetches. Without it, any request whose
 * header carries an arbitrary `kid` would trigger one outbound fetch to the team
 * domain: a cheap unauthenticated request could be amplified into a 5-second
 * upstream fetch on every attempt. Real signing-key rotation happens at most
 * once per cooldown, so the cache is refreshed on the next request after it.
 */
const FORCED_REFRESH_COOLDOWN_MS = 30_000;
/**
 * Astro fully decodes the pathname before routing (see its
 * `validateAndDecodePathname`), so the audience decision below has to decode the
 * same way or `/%61pi/admin/...` would pick the page audience for an API route.
 */
const MAX_PATH_DECODE_ITERATIONS = 10;
let cachedKeys: CachedKeys | null = null;
let lastForcedRefreshAt = 0;

function decodeBase64Url(segment: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error('Invalid base64url');
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decodeJsonSegment<T>(segment: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(segment))) as T;
}

function normalizeIssuer(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== '/' && url.pathname !== '') return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function fetchAccessKeys(issuer: string, fetcher: typeof fetch, force = false): Promise<Map<string, CryptoKey>> {
  if (!force && cachedKeys?.issuer === issuer && cachedKeys.expiresAt > Date.now()) return cachedKeys.keys;

  if (force) {
    const now = Date.now();
    if (now - lastForcedRefreshAt < FORCED_REFRESH_COOLDOWN_MS) {
      // Unknown `kid` on an otherwise plausible token: serve whatever the last
      // fetch produced instead of letting the caller drive an outbound fetch.
      return cachedKeys?.issuer === issuer ? cachedKeys.keys : new Map();
    }
    lastForcedRefreshAt = now;
  }

  const response = await fetcher(`${issuer}/cdn-cgi/access/certs`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error('Access signing keys unavailable');

  const jwks = (await response.json()) as JwkSet;
  if (!Array.isArray(jwks.keys) || jwks.keys.length === 0 || jwks.keys.length > 32) {
    throw new Error('Invalid Access signing key set');
  }

  const keys = new Map<string, CryptoKey>();
  for (const jwk of jwks.keys) {
    const kid = (jwk as JsonWebKey & { kid?: string }).kid;
    const alg = (jwk as JsonWebKey & { alg?: string }).alg;
    const use = (jwk as JsonWebKey & { use?: string }).use;
    if (!kid || jwk.kty !== 'RSA' || (alg && alg !== 'RS256') || (use && use !== 'sig')) continue;
    try {
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
        'verify',
      ]);
      keys.set(kid, key);
    } catch {
      // Ignore malformed or unsupported keys while preserving valid rotations.
    }
  }

  if (keys.size === 0) throw new Error('No usable Access signing keys');
  cachedKeys = { issuer, expiresAt: Date.now() + JWKS_CACHE_MS, keys };
  return keys;
}

export function resetAccessKeyCacheForTests(): void {
  cachedKeys = null;
  lastForcedRefreshAt = 0;
}

/**
 * Canonical pathname used to decide which Access Application audience a request
 * must present.
 *
 * The middleware hands this module the raw `request.url`, not Astro's already
 * normalised context URL, so the raw path has to be canonicalised here as well:
 * percent-decode it (repeatedly — `%2561` is `a`), let the WHATWG URL parser
 * resolve `.` / `..` segments (`%2e` counts as a dot there, matching Astro), and
 * collapse duplicate slashes. Otherwise `//api/admin/posts` or
 * `/api/%61dmin/posts` would be classified as an admin *page* request and a
 * page-application JWT could reach the API application.
 */
export function normalizeAdminPathname(pathname: string): string {
  let decoded = pathname;
  for (let iteration = 0; iteration < MAX_PATH_DECODE_ITERATIONS; iteration += 1) {
    let next: string;
    try {
      // decodeURI leaves the reserved characters (%2F, %3F, %23) encoded, which
      // is exactly what Astro's own pathname decoder does — a `%2F` never
      // becomes a path separator on either side.
      next = decodeURI(decoded);
    } catch {
      break;
    }
    if (next === decoded) break;
    decoded = next;
  }

  try {
    decoded = new URL(`https://access.invalid${decoded.startsWith('/') ? '' : '/'}${decoded}`).pathname;
  } catch {
    // Keep the decoded form when the URL parser rejects it.
  }
  return decoded.replace(/\/{2,}/g, '/');
}

/** True when a pathname belongs to the `/api/admin` route family. */
export function isCloudflareAccessApiPath(pathname: string): boolean {
  const normalized = normalizeAdminPathname(pathname);
  return normalized === '/api/admin' || normalized.startsWith('/api/admin/');
}

/** Verify issuer, audience, timestamps, signing algorithm, key ID and RSA signature. */
export async function verifyCloudflareAccessJwt(
  token: string,
  options: {
    teamDomain?: string;
    audience?: string | string[];
    nowSeconds?: number;
    fetcher?: typeof fetch;
  },
): Promise<boolean> {
  const issuer = normalizeIssuer(options.teamDomain);
  const expectedAudiences = (Array.isArray(options.audience) ? options.audience : [options.audience])
    .flatMap((value) => (typeof value === 'string' ? value.split(',') : []))
    .map((value) => value.trim())
    .filter(Boolean);
  if (!issuer || expectedAudiences.length === 0 || !token || token.length > MAX_JWT_LENGTH) return false;

  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) return false;

  try {
    const header = decodeJsonSegment<AccessJwtHeader>(parts[0]);
    const payload = decodeJsonSegment<AccessJwtPayload>(parts[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 128) return false;
    if (payload.iss !== issuer) return false;

    const tokenAudiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!tokenAudiences.some((value) => typeof value === 'string' && expectedAudiences.includes(value))) return false;

    const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || now - CLOCK_SKEW_SECONDS >= payload.exp) {
      return false;
    }
    // `iat` is present on every Access JWT (user and service tokens alike), so a
    // missing or non-numeric value is rejected instead of being ignored.
    if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat) || payload.iat > now + CLOCK_SKEW_SECONDS) {
      return false;
    }
    // `nbf` is verified whenever it is present. Service-token JWTs do not always
    // carry it, so absence is not treated as a failure — the signature plus the
    // exact issuer/audience are what establish authenticity.
    if (
      payload.nbf !== undefined &&
      (typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf) || payload.nbf > now + CLOCK_SKEW_SECONDS)
    ) {
      return false;
    }

    const fetcher = options.fetcher ?? fetch;
    let keys = await fetchAccessKeys(issuer, fetcher);
    let key = keys.get(header.kid);
    if (!key) {
      // Retry once to handle Cloudflare signing-key rotation.
      keys = await fetchAccessKeys(issuer, fetcher, true);
      key = keys.get(header.kid);
    }
    if (!key) return false;

    return await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      key,
      decodeBase64Url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    return false;
  }
}

/** Resolve the one Access Application audience that is valid for this route. */
export function getCloudflareAccessAudience(request: Request, environment: AccessJwtEnvironment): string | null {
  const isAdminApi = isCloudflareAccessApiPath(new URL(request.url).pathname);
  const splitConfiguration = Boolean(environment.ACCESS_ADMIN_AUD || environment.ACCESS_API_AUD);
  // Once either route-specific AUD is configured, require both. Do not fall
  // back to ACCESS_AUD for the other route: a partial split config must fail closed.
  const routeAudience = splitConfiguration
    ? isAdminApi
      ? environment.ACCESS_API_AUD
      : environment.ACCESS_ADMIN_AUD
    : environment.ACCESS_AUD;
  const audience = (routeAudience || '').trim();

  // A comma-separated global allow-list would let a JWT issued for one path
  // family authenticate against the other. Use route-specific variables when
  // separate Access Applications protect pages and APIs.
  if (!audience || audience.includes(',')) return null;
  return audience;
}

export async function verifyCloudflareAccessRequest(
  request: Request,
  environment: AccessJwtEnvironment,
): Promise<'ok' | 'not-configured' | 'missing-token' | 'invalid-token'> {
  const issuer = normalizeIssuer(environment.ACCESS_TEAM_DOMAIN);
  const audience = getCloudflareAccessAudience(request, environment);
  if (!issuer || !audience) return 'not-configured';

  // Cloudflare recommends the signed assertion header. Do not fall back to a
  // client-supplied cookie, which may be absent or replayed outside this app.
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return 'missing-token';

  return (await verifyCloudflareAccessJwt(token, { teamDomain: issuer, audience })) ? 'ok' : 'invalid-token';
}
