import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import swup from '@swup/astro';
import { satteri } from '@astrojs/markdown-satteri';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { loreLinksPlugin } from './src/lib/lore-plugin.mjs';
import { markdownSanitize } from './src/lib/markdown-sanitize.mjs';
import { createWatermarkPlugin } from './src/lib/watermark-plugin.mjs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
const repoRoot = new URL('.', import.meta.url);
const gitFirstCommit = (() => {
  try {
    return execSync('git log --reverse --format=%cI --date=iso', { cwd: repoRoot }).toString().trim().split('\n')[0];
  } catch {
    return new Date().toISOString();
  }
})();
const buildTime = new Date().toISOString();
const nodeVersion = process.version;
const typescriptVersion = pkg.devDependencies?.typescript || 'unknown';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    // Images are optimised once, at build time, by Astro's own `sharp`-backed
    // pipeline (`<Image />` in BaseLayout for the background). "compile" emits
    // the finished files into `_astro/` with content hashes, so the Worker never
    // transforms an image at request time and the adapter's Cloudflare Images
    // binding (auto-provisioned as "IMAGES", which collided with our R2 binding
    // of that name before it became BLOG_IMAGES) is not needed.
    //
    // Two kinds of route now share those build-time assets:
    // - prerendered ones (`/`, `/privacy`, `/terms`, `/404`, `/posts/blog/*`,
    //   `/posts/novel/*`, `/dictionary/*`, `/world/*` via
    //   `export const prerender = true`) bake the hashed `srcset`/`src` straight
    //   into their HTML at build time;
    // - the remaining on-demand pages (`/posts`, the wiki list pages, …) resolve
    //   `<Image />` while server-rendering. With "compile" the adapter
    //   maps that to its `/_image` **passthrough** endpoint
    //   (`@astrojs/cloudflare/image-passthrough-endpoint`), which streams the
    //   already-built file from the `ASSETS` binding instead of transforming it,
    //   so it neither needs the `IMAGES` binding nor a runtime sharp build.
    // Keep one adapter: the passthrough is part of it, not an extra integration.
    imageService: 'compile',
    // Prerendered routes run in Cloudflare's workerd runtime by default: the
    // adapter starts a local workerd preview server and fetches each static
    // path from it. The OG PNG routes (`/og.png`, `/og/[slug].png`) rasterise
    // the card with `@resvg/resvg-js` (a native Node addon) and read the
    // subsetted font from disk, so they need Node at build time. This only
    // changes *how* the static files are generated — the prerendered HTML/PNG
    // output is deployed as plain static assets either way.
    prerenderEnvironment: 'node',
  }),
  site: 'https://fluentfolio.bloodmoon912.de5.net',
  // Astro 7's default Markdown processor is Sätteri, so `[[word]]` is turned
  // into a <span class="lore-word" data-lore-word data-tooltip> by a Sätteri
  // mdast plugin (not a remark plugin). Definitions are read from the
  // dictionary collection at build time and inlined; there is no runtime API.
  //
  // The sanitizer runs LAST so raw HTML and Markdown URLs (including anything
  // produced by the lore plugin) are filtered before they reach the page. Its
  // allowlist keeps the lore span's class/data attributes — see
  // src/lib/markdown-sanitize.mjs.
  markdown: {
    processor: satteri({
      // The watermark runs after lore links and before the sanitizer: it only
      // appends invisible text at paragraph boundaries, and the sanitizer does
      // not touch text nodes. No WATERMARK_SECRET means the plugin is skipped.
      mdastPlugins: [loreLinksPlugin, createWatermarkPlugin()],
      hastPlugins: [markdownSanitize],
    }),
  },
  integrations: [
    swup({
      theme: false,
      animationClass: 'transition-',
      containers: ['main'],
      cache: true,
      preload: { hover: true, visible: true },
      accessibility: true,
      progress: true,
      smoothScrolling: true,
      updateHead: { awaitAssets: false, persistAssets: true },
      reloadScripts: true,
      globalInstance: false,
    }),
  ],
  vite: {
    define: {
      __SITE_BUILD__: JSON.stringify({
        startedAt: gitFirstCommit,
        astroVersion: pkg.dependencies?.astro || 'unknown',
        wranglerVersion: pkg.devDependencies?.wrangler || 'unknown',
        buildTime,
        nodeVersion,
        typescriptVersion,
      }),
    },
    // `astro dev` pre-bundles dependencies with Rolldown, which cannot parse the
    // native `.node` binary inside `@resvg/resvg-js`. Excluding it from
    // pre-bundling makes the Node prerender/dev environment load the package
    // through Node's own module loader instead (same as the build external
    // below).
    optimizeDeps: {
      exclude: ['@resvg/resvg-js'],
    },
    // The prerender environment runs on Node (see `prerenderEnvironment`) and
    // must load the native `@resvg/resvg-js` package from node_modules at build
    // time instead of bundling its platform binary. The Cloudflare adapter
    // bundles every server dependency and clears `ssr.external`, so this is a
    // build-level external on the prerender environment only. The Worker (ssr)
    // bundle never imports the package.
    environments: {
      prerender: {
        build: {
          rolldownOptions: {
            external: ['@resvg/resvg-js'],
          },
        },
      },
    },
  },
});
