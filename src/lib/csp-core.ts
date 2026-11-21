// Pure helpers for the Content-Security-Policy Report-Only rollout (#14).
//
// Deliberately free of `cloudflare:workers` and Astro imports so
// `tests/middleware.test.ts` (plain `node --test`) can exercise the policy
// builder directly. Nothing here enforces anything: the enforced header in
// `src/middleware.ts` still only carries `frame-ancestors` / `object-src` /
// `base-uri`. The Report-Only policy below is the candidate full policy, shipped
// for observation first.
//
// Astro 7's built-in `security.csp` option is deliberately NOT used: it emits an
// **enforced** `<meta http-equiv="content-security-policy">` element (no
// Report-Only mode) and meta CSP ignores `frame-ancestors`/reporting directives.
// See DEPLOY-CLOUDFLARE.md and the #14 report for the full finding.

export const CSP_REPORT_ONLY_HEADER = 'content-security-policy-report-only';

/**
 * Third-party image origins the site legitimately renders: Discord CDN
 * (presence art), Steam (avatars / store art), Spotify artwork inside a Discord
 * presence, and the Ko-fi / Liberapay badges. The R2 public origin is appended
 * at request time from `R2_PUBLIC_BASE_URL` because it is deployment config.
 */
export const DEFAULT_IMAGE_ORIGINS = [
  'https://cdn.discordapp.com',
  'https://media.discordapp.net',
  'https://i.scdn.co',
  'https://avatars.steamstatic.com',
  'https://media.steampowered.com',
  'https://cdn.akamai.steamstatic.com',
  'https://shared.akamai.steamstatic.com',
  'https://storage.ko-fi.com',
  'https://liberapay.com',
] as const;

/** Normalize a configured base URL to an origin; only https origins are kept. */
export function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

export interface CspReportOnlyOptions {
  /** Extra image origins, e.g. the `R2_PUBLIC_BASE_URL` origin. */
  imageOrigins?: readonly string[];
}

/**
 * Build the Report-Only candidate policy. Kept as one string so the middleware
 * sets exactly one header per HTML document (and tests can assert on it).
 *
 * There is no nonce: every executable script is served same-origin from
 * `/scripts/…` or `/…/_astro/…`, so `'self'` covers them on both SSR and
 * prerendered pages. JSON data blocks (`type="application/json"`,
 * `application/ld+json`) are not executable and are not governed by script-src.
 */
export function buildCspReportOnlyPolicy({ imageOrigins = [] }: CspReportOnlyOptions = {}): string {
  const images = [...new Set([...DEFAULT_IMAGE_ORIGINS, ...imageOrigins])].sort();
  return [
    "default-src 'self'",
    // Turnstile injects its widget script from challenges.cloudflare.com; the
    // site's own scripts are all same-origin files under /scripts/.
    "script-src 'self' https://challenges.cloudflare.com",
    // Styles are bundled CSS; 'unsafe-inline' is required by existing inline
    // style attributes and would be a follow-up cleanup, not a reason to hide
    // real script violations during the observation period.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${images.length > 0 ? ` ${images.join(' ')}` : ''}`,
    "font-src 'self' data:",
    "media-src 'self'",
    "connect-src 'self' https://api.lanyard.rest wss://api.lanyard.rest https://challenges.cloudflare.com",
    'frame-src https://challenges.cloudflare.com',
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
  ].join('; ');
}
