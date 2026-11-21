/// <reference types="astro/client" />

/** Minimal Workers Rate Limiting binding shape used by /api/admin/login. */
interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface Env {
  DB?: D1Database;
  STEAM_API_KEY?: string;
  STEAM_ID?: string;
  /** Salt used to hash visitor IPs. Required in production: when it is absent,
   * POST /api/visitors skips the D1 write and returns `{ recorded: false }`
   * instead of hashing with a predictable fallback. */
  VISITOR_SALT?: string;
  VISITOR_COOKIE_SECRET?: string;
  DISCORD_USER_ID?: string;

  // --- Turnstile (bot protection for POST /api/visitors) ---
  /** When set, that endpoint requires a verified Turnstile token; when absent it
   * fails open and behaves exactly as it did before Turnstile existed. It is not
   * a fallback for any cookie-signing secret. */
  TURNSTILE_SECRET?: string;
  /** Comma-separated allow-list checked against the hostname siteverify reports.
   * Advisory by design: an empty value accepts any hostname, because the sitekey
   * is already hostname-restricted in the Cloudflare dashboard and a drifting
   * list here once rejected every real visitor. */
  TURNSTILE_HOSTNAMES?: string;

  // --- Cloudflare Access edge identity + Worker-side JWT verification ---
  /** Exact Cloudflare Zero Trust team issuer, e.g. https://example.cloudflareaccess.com */
  ACCESS_TEAM_DOMAIN?: string;
  /** Shared Application Audience (AUD) when one Access app protects pages and API. */
  ACCESS_AUD?: string;
  /** AUD for /admin pages when a dedicated Access app protects them. */
  ACCESS_ADMIN_AUD?: string;
  /** AUD for /api/admin/* when a dedicated Access app protects the API. */
  ACCESS_API_AUD?: string;

  // --- Admin CMS (Phase 2/3/4) ---
  /** R2 bucket used to store images uploaded from the admin CMS. Named
   * BLOG_IMAGES (not IMAGES) because @astrojs/cloudflare already reserves
   * "IMAGES" for its own Cloudflare Images binding. */
  BLOG_IMAGES?: R2Bucket;
  /** Public base URL that serves the BLOG_IMAGES bucket, e.g. https://img.example.com/ */
  R2_PUBLIC_BASE_URL?: string;

  /** Password gate for /admin. Store as a Wrangler secret, never in vars. */
  ADMIN_PASSWORD?: string;
  /** Secret used to sign the admin session cookie. Must be dedicated to this
   * purpose; there is no fallback to the visitor or Turnstile secrets. */
  ADMIN_SESSION_SECRET?: string;
  /** Workers Rate Limiting binding for failed admin logins (wrangler.jsonc). */
  ADMIN_LOGIN_RATE_LIMIT?: RateLimit;
  /** WebAuthn RP ID and exact origin; set to the canonical public hostname. */
  ADMIN_WEBAUTHN_RP_ID?: string;
  ADMIN_WEBAUTHN_ORIGIN?: string;
  /** Workers Rate Limiting binding for passkey ceremonies (wrangler.jsonc). */
  ADMIN_PASSKEY_RATE_LIMIT?: RateLimit;
  /** Workers Rate Limiting binding for POST /api/visitors (wrangler.jsonc):
   * 60 views per IP per minute, then 429. Over-limit requests never touch D1. */
  VISITOR_RATE_LIMIT?: RateLimit;

  /** Fine-grained GitHub PAT scoped to Contents read/write on this repo only. */
  GITHUB_TOKEN?: string;
  /** "owner/repo" for the site's GitHub repository. */
  GITHUB_REPO?: string;
  /** Branch that Cloudflare Workers Builds deploys from. */
  GITHUB_BRANCH?: string;

  /** Discord Incoming Webhook URL for the "new post published" notification. */
  DISCORD_BLOG_WEBHOOK_URL?: string;
}

declare namespace App {
  // `Locals` currently has no members. The Report-Only CSP policy is nonce-free
  // (#14 follow-up), so there is no per-request value to pass to the layout.
  interface Locals {}
}
