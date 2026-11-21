// Ambient types for the browser scripts in public/scripts/.
//
// These files are copied verbatim into dist/client and never bundled, so they
// cannot import modules for their types. `tsconfig.public.json` includes this
// file (and src/page-globals.d.ts, which declares the helpers installed by
// BaseLayout) to type-check them without adding runtime dependencies.
//
// Keep this in sync with the APIs the scripts actually call:
// - window.turnstile: the Cloudflare Turnstile explicit-render API.

export {};

declare global {
  interface TurnstileRenderOptions {
    sitekey: string;
    action: string;
    appearance: 'always' | 'execute' | 'interaction-only';
    execution: 'render' | 'execute';
    theme: 'light' | 'dark' | 'auto';
    'refresh-expired': 'auto' | 'manual' | 'never';
    'refresh-timeout': 'auto' | 'manual' | 'never';
    retry: 'auto' | 'never';
    callback: (token: string) => void;
    'before-interactive-callback': () => void;
    'after-interactive-callback': () => void;
    'expired-callback': () => void;
    'error-callback': (errorCode: string) => void;
    'timeout-callback': () => void;
  }

  /** The subset of the Turnstile API this site uses. */
  interface TurnstileApi {
    render(container: HTMLElement, options: TurnstileRenderOptions): string;
    execute(widgetId: string): void;
    remove(widgetId: string): void;
  }

  interface Window {
    /** Injected by https://challenges.cloudflare.com/turnstile/v0/api.js. */
    turnstile?: TurnstileApi;
    /** Set once markdown-enhance.js has bound its listeners. */
    __bmMarkdownEnhanceBound?: boolean;
    /** Set once image-lightbox.js has bound its delegated listener. */
    __bmImageLightboxBound?: boolean;
  }

  // `/api/status` payload, consumed by status-panel.js. Declared here rather
  // than as JSDoc typedefs in the script because that file is a global script
  // (no imports/exports), and TypeScript 6 reports a duplicate identifier for
  // the multi-property typedef block there.
  interface EdgeJson {
    colo?: string | null;
    city?: string | null;
    region?: string | null;
    country?: string | null;
    httpProtocol?: string | null;
    tlsVersion?: string | null;
  }

  interface StatusSystemJson {
    runtime?: string;
    now?: string;
    edge?: EdgeJson;
  }

  interface StatusServiceJson {
    key: string;
    ok: boolean;
    latencyMs: number;
    detailCode: string;
  }

  interface StatusHistoryJson {
    checkedAt: number;
    ok: boolean;
    detail: string;
  }

  interface StatusJson {
    ok: boolean;
    checkedAt: string;
    services: StatusServiceJson[];
    history?: StatusHistoryJson[];
    system?: StatusSystemJson;
  }

  interface Element {
    /** Relabel hook stored on the copy button for `bm:lang` changes. */
    __mdShowIdle?: () => void;
  }
}
