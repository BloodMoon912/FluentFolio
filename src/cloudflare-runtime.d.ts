// Minimal ambient declarations for the Cloudflare Workers runtime surface this
// project actually uses.
//
// Why this file exists: `astro check` type-checks everything under src/, but
// nothing ever installs `@cloudflare/workers-types` or commits `wrangler types`
// output, so `cloudflare:workers`, `D1Database` and `RequestInit.cf` resolved to
// nothing. Those unresolved names accounted for 17 of this repository's 65
// pre-existing type errors and made a red `astro check` unreadable — a real
// error was impossible to spot among the noise.
//
// `npm run cf-typegen` is deliberately not wired into compilation (see
// AGENTS.md), so the declarations live here instead of in generated output.
// Keep this file in sync with src/env.d.ts and wrangler.jsonc whenever a
// binding, a D1 table or a Cloudflare request extension changes.

declare module 'cloudflare:workers' {
  export const env: Env;
}

// --- D1 ---------------------------------------------------------------------

interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<unknown>;
}

// --- R2 ---------------------------------------------------------------------

interface R2Bucket {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | Blob,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<unknown>;
  delete(key: string | string[]): Promise<void>;
}

// --- Worker execution context ----------------------------------------------

/**
 * Request-scoped Worker context. `@astrojs/cloudflare` exposes it to Astro as
 * `locals.cfContext`; the `waitUntil()` half is where best-effort background
 * work (such as the visitor-statistics retention DELETE) belongs, so returning
 * the response does not cancel it.
 */
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// --- Cache API (Workers `caches.default`) ------------------------------------

/**
 * The subset of the Workers Cache API the site uses. Only the WebWorker lib
 * declares the global `caches`, and this project does not load it (see the
 * header of this file), so the global is declared here.
 */
interface Cache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

interface CacheStorage {
  readonly default: Cache;
}

declare const caches: CacheStorage;

// --- Cloudflare request extensions -----------------------------------------

interface RequestInit {
  /** Workers-only fetch options: `cacheTtl` seconds, cache all responses. */
  cf?: {
    cacheTtl?: number;
    cacheEverything?: boolean;
    [key: string]: unknown;
  };
}

interface Request {
  /** Edge metadata Cloudflare attaches to every incoming request. */
  cf?: {
    country?: string;
    city?: string;
    colo?: string;
    region?: string;
    asOrganization?: string;
    httpProtocol?: string;
    tlsVersion?: string;
  };
}
