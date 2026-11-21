#!/usr/bin/env node
/**
 * Vendor the Fluent UI System Icons SVGs this site actually uses.
 *
 * Why this exists (audit #22): every icon used to be loaded at runtime from a
 * third-party icon CDN — `FluentIcon.astro` for the component icons,
 * `BaseLayout.astro` for the theme toggle (`setIcon`) and
 * `public/scripts/home-dashboard.js` for the activity buttons. That made an
 * external host a hard dependency of every page view (and a privacy-policy
 * liability). The icons are MIT-licensed, so the exact files are copied into
 * `public/icons/fluent/` and served by this site.
 *
 * Source of truth: the npm package `@fluentui/svg-icons@1.1.339`, fetched as
 * the registry tarball
 * `https://registry.npmjs.org/@fluentui/svg-icons/-/svg-icons-1.1.339.tgz`
 * (registry.npmjs.org is the only network dependency; no icon CDN is used).
 * Upstream: https://github.com/microsoft/fluentui-system-icons (MIT,
 * Copyright (c) 2020 Microsoft Corporation). The npm package ships no licence
 * file, so this script writes the upstream MIT text plus provenance into
 * `public/icons/fluent/LICENSE`.
 *
 * Usage:
 *   node scripts/vendor-fluent-icons.mjs           # fetch + write/refresh SVGs
 *   node scripts/vendor-fluent-icons.mjs --check    # verify committed files, offline
 *
 * `--check` never touches the network: the SVGs are committed, and it only
 * asserts that every expected file exists and is a well-formed Fluent SVG of
 * the size its name advertises (plus the licence file). Run the write mode only
 * when bumping FLUENT_VERSION, and update the consumers in the same change:
 * `src/components/FluentIcon.astro` (its `fileMap` must stay in sync with
 * ICON_FILES), `src/layouts/BaseLayout.astro` (theme toggle icon URLs) and
 * `public/scripts/home-dashboard.js` (activity-button icon URL).
 */

import { gunzipSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const FLUENT_PACKAGE = '@fluentui/svg-icons';
const FLUENT_VERSION = '1.1.339';
// npm registry tarball for the scoped package (same bytes as `npm pack`).
const TARBALL_URL = `https://registry.npmjs.org/${FLUENT_PACKAGE}/-/svg-icons-${FLUENT_VERSION}.tgz`;
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUTPUT_DIR = join(REPO_ROOT, 'public', 'icons', 'fluent');

/**
 * The complete set of icons referenced by the site. Keep this list sorted by the
 * first consumer, then by file name: it is the single source of truth for what
 * must exist in `public/icons/fluent/`.
 */
const ICON_FILES = [
  // FluentIcon.astro `fileMap` (all 19 names the component can render).
  'arrow_down_24_regular.svg',
  'arrow_left_24_regular.svg',
  'arrow_right_24_regular.svg',
  'arrow_up_right_24_regular.svg', // also home-dashboard.js activity buttons
  'book_24_regular.svg',
  'checkmark_circle_24_regular.svg',
  'chevron_down_24_regular.svg',
  'code_24_regular.svg',
  'dark_theme_24_regular.svg', // also BaseLayout.astro setIcon (dark theme)
  'database_24_regular.svg',
  'error_circle_24_regular.svg',
  'games_24_regular.svg',
  'globe_24_regular.svg',
  'home_24_regular.svg',
  'info_24_regular.svg',
  'lightbulb_filament_24_regular.svg', // also BaseLayout.astro setIcon (light theme)
  'line_horizontal_3_20_regular.svg', // FluentIcon name "menu" (20px size)
  'search_24_regular.svg',
  'translate_24_regular.svg', // FluentIcon name "language"
];

const LICENCE = `Fluent UI System Icons (SVG)
${FLUENT_PACKAGE}@${FLUENT_VERSION}

Source: https://github.com/microsoft/fluentui-system-icons
These SVG files are copied verbatim from the npm package named above
(https://www.npmjs.com/package/@fluentui/svg-icons), downloaded as the npm
registry tarball. The package does not ship a separate licence file; this is
the upstream repository's licence.

-------------------------------------------------------------------------------

MIT License

Copyright (c) 2020 Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const checkOnly = process.argv.includes('--check');

/** @param {Buffer} buffer @param {number} offset @param {number} length */
function readTarString(buffer, offset, length) {
  const raw = buffer.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8');
}

/**
 * Minimal USTAR reader — enough for an npm tarball. Returns a map of
 * tarball-relative path → file bytes (directory entries are skipped).
 *
 * @param {Buffer} gzBytes
 * @returns {Map<string, Buffer>}
 */
function extractTarball(gzBytes) {
  const buffer = gunzipSync(gzBytes);
  /** @type {Map<string, Buffer>} */
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const name = readTarString(buffer, offset, 100);
    if (!name) break; // end-of-archive marker (two zero blocks)
    const size = Number.parseInt(readTarString(buffer, offset + 124, 12).trim(), 8) || 0;
    const dataStart = offset + 512;
    if (name.endsWith('/')) {
      offset = dataStart + Math.ceil(size / 512) * 512;
      continue;
    }
    files.set(name, buffer.subarray(dataStart, dataStart + size));
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** The SVG size the file name advertises (`…_24_regular.svg` → 24). @param {string} file @returns {number | null} */
function expectedSize(file) {
  const match = file.match(/_(\d+)_regular\.svg$/);
  return match ? Number(match[1]) : null;
}

/** Structural check shared by the offline `--check` and the write path.
 * @param {string} file @param {string} content @returns {string | null}
 */
function looksLikeFluentSvg(file, content) {
  const size = expectedSize(file);
  if (size === null) return `${file}: name does not follow <name>_<size>_regular.svg`;
  if (!content.startsWith('<svg ')) return `${file}: does not start with "<svg "`;
  if (!content.includes('xmlns="http://www.w3.org/2000/svg"')) return `${file}: missing SVG namespace`;
  if (!content.includes(`viewBox="0 0 ${size} ${size}"`)) return `${file}: missing viewBox "0 0 ${size} ${size}"`;
  if (!content.includes('<path ') && !content.includes('<g ') && !content.includes('<rect ')) {
    return `${file}: contains no drawable element`;
  }
  return null;
}

/** @param {string} path @returns {Promise<string | null>} */
async function readIfPresent(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

if (checkOnly) {
  /** @type {string[]} */
  const problems = [];
  for (const file of ICON_FILES) {
    const content = await readIfPresent(join(OUTPUT_DIR, file));
    if (content === null) {
      problems.push(`${file}: missing from public/icons/fluent/`);
      continue;
    }
    const problem = looksLikeFluentSvg(file, content);
    if (problem) problems.push(problem);
  }
  const licence = await readIfPresent(join(OUTPUT_DIR, 'LICENSE'));
  if (licence === null) problems.push('LICENSE: missing from public/icons/fluent/');
  else if (!licence.includes('MIT License') || !licence.includes(`${FLUENT_PACKAGE}@${FLUENT_VERSION}`)) {
    problems.push('LICENSE: does not contain the MIT text / package provenance');
  }

  if (problems.length > 0) {
    console.error(`✗ ${problems.length} problem(s) with public/icons/fluent/:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ ${ICON_FILES.length} vendored icons + LICENSE are present and well-formed (offline check).`);
  }
} else {
  console.log(`Fetching ${TARBALL_URL}…`);
  const response = await fetch(TARBALL_URL);
  if (!response.ok) throw new Error(`Failed to download ${TARBALL_URL}: HTTP ${response.status}`);
  const files = extractTarball(Buffer.from(await response.arrayBuffer()));

  await mkdir(OUTPUT_DIR, { recursive: true });
  let written = 0;
  for (const file of ICON_FILES) {
    const entry = files.get(`package/icons/${file}`);
    if (!entry) throw new Error(`${file} is missing from the ${FLUENT_PACKAGE}@${FLUENT_VERSION} tarball`);
    const content = entry.toString('utf8');
    const problem = looksLikeFluentSvg(file, content);
    if (problem) throw new Error(`Downloaded ${problem}`);
    await writeFile(join(OUTPUT_DIR, file), content, 'utf8');
    written += 1;
  }
  await writeFile(join(OUTPUT_DIR, 'LICENSE'), LICENCE, 'utf8');
  console.log(`✓ Wrote ${written} icons + LICENSE to public/icons/fluent/ (from ${FLUENT_PACKAGE}@${FLUENT_VERSION})`);
}
