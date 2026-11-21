#!/usr/bin/env node
// Post-build check for the prerendered Open Graph PNGs (#6).
//
// The OG cards are static files after `npm run build`, so a broken rasteriser,
// a missing font or a route that silently stopped prerendering is invisible in
// the build log. This script verifies the files that were actually emitted:
//
// - `/og.png` always exists (the site default card);
// - every published single-segment blog/novel entry has `/og/<id>.png`;
// - every checked file starts with the PNG magic bytes and has an IHDR chunk
//   declaring 1200x630, which is what `renderOgSvg` and the meta tags promise.
//
// Usage: node scripts/check-og-png.mjs [clientDir]   (default: dist/client)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WIDTH = 1200;
const HEIGHT = 630;
const clientDir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist/client');

let failures = 0;

/** @param {string} message */
function fail(message) {
  failures += 1;
  console.error(`FAIL ${message}`);
}

/**
 * Reads the PNG signature and the IHDR dimensions (the IHDR data always starts
 * at byte 16 in a valid PNG: 8 signature + 4 length + 4 chunk type).
 * @param {string} file
 */
function checkPng(file) {
  const buffer = readFileSync(file);
  if (buffer.length < 24) {
    fail(`${file}: too short to be a PNG (${buffer.length} bytes)`);
    return;
  }
  if (!buffer.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    fail(`${file}: not a PNG (magic ${buffer.subarray(0, 4).toString('hex')}, expected 89504e47)`);
    return;
  }
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') {
    fail(`${file}: missing IHDR chunk`);
    return;
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width !== WIDTH || height !== HEIGHT) {
    fail(`${file}: ${width}x${height}, expected ${WIDTH}x${HEIGHT}`);
    return;
  }
  console.log(`ok   ${path.relative(clientDir, file)} (${width}x${height}, ${buffer.length} bytes)`);
}

/**
 * Published single-segment entries that should have their own card. `/og/[slug].png`
 * is one path segment, so nested ids (e.g. `guides/setup`) use the site default
 * card and are skipped here — mirroring `getStaticPaths` in the route.
 * @param {string} collection
 */
function expectedArticleIds(collection) {
  const dir = path.resolve('src/content', collection);
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const ids = [];
  /** @param {string} current */
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.md')) continue;
      const id = path.relative(dir, full).replace(/\\/g, '/').replace(/\.md$/, '');
      if (id.includes('/')) continue;
      const source = readFileSync(full, 'utf8');
      const frontmatter = source.split('\n---', 1)[0] ?? '';
      if (/^draft:\s*true\s*$/m.test(frontmatter)) continue;
      ids.push(id);
    }
  };
  walk(dir);
  return ids.sort();
}

if (!existsSync(clientDir)) {
  console.error(`check-og-png: ${clientDir} does not exist. Run \`npm run build\` first.`);
  process.exit(1);
}

const defaultCard = path.join(clientDir, 'og.png');
if (!existsSync(defaultCard)) fail(`${path.relative(process.cwd(), defaultCard)}: missing`);
else checkPng(defaultCard);

const expected = [...expectedArticleIds('blog'), ...expectedArticleIds('novel')].sort();
const articleDir = path.join(clientDir, 'og');
for (const id of expected) {
  const file = path.join(articleDir, `${id}.png`);
  if (!existsSync(file)) {
    fail(`${path.relative(process.cwd(), file)}: missing (published entry "${id}")`);
    continue;
  }
  checkPng(file);
}

// The reverse direction: a stale/extra article PNG means the route emitted
// something the content collections no longer contain.
if (existsSync(articleDir)) {
  const emitted = readdirSync(articleDir)
    .filter((name) => name.endsWith('.png'))
    .map((name) => name.slice(0, -'.png'.length))
    .sort();
  for (const id of emitted) {
    if (!expected.includes(id))
      fail(`${path.relative(process.cwd(), articleDir)}/${id}.png: no published entry "${id}"`);
  }
  if (emitted.length === 0) {
    console.log('note no per-article PNGs were emitted (no published blog/novel entries)');
  }
} else {
  console.log('note no dist/client/og directory (no published blog/novel entries)');
}

if (failures > 0) {
  console.error(`\ncheck-og-png: ${failures} problem(s).`);
  process.exit(1);
}

console.log(`\ncheck-og-png: ${1 + expected.length} PNG file(s) verified.`);
