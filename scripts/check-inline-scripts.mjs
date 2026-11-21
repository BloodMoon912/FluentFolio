#!/usr/bin/env node
/**
 * Fail the build if any emitted HTML still contains an *executable* inline
 * script.
 *
 * The Report-Only CSP policy uses `script-src 'self' https://challenges.cloudflare.com`
 * with no nonce, so an inline `<script>` would be blocked the day the policy is
 * enforced. Data blocks are fine: `type="application/json"` and
 * `type="application/ld+json"` are not executed and are not governed by
 * `script-src`.
 *
 * Usage: `node scripts/check-inline-scripts.mjs` (after `npm run build`).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const ALLOWED_TYPES = new Set(['application/json', 'application/ld+json']);

/** @param {string} dir @returns {string[]} */
function htmlFiles(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...htmlFiles(full));
    } else if (entry.endsWith('.html')) {
      found.push(full);
    }
  }
  return found;
}

/**
 * @param {string} attrs
 * @returns {string | null} the declared `type`, lowercased, or null when absent
 */
function scriptType(attrs) {
  const match = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
  if (!match) return null;
  return (match[1] ?? match[2] ?? match[3] ?? '').trim().toLowerCase();
}

/** @param {string} text @param {number} index */
function lineNumber(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

const violations = [];

let files;
try {
  files = htmlFiles(DIST);
} catch (error) {
  console.error(`check-inline-scripts: cannot read ${DIST}: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

for (const file of files) {
  const html = readFileSync(file, 'utf8');
  const scriptTag = /<script\b([^>]*)>/gi;
  let match;
  while ((match = scriptTag.exec(html)) !== null) {
    const attrs = match[1] ?? '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = scriptType(attrs);
    if (type !== null && ALLOWED_TYPES.has(type)) continue;
    violations.push({
      file: relative(process.cwd(), file).replaceAll('\\', '/'),
      line: lineNumber(html, match.index),
      snippet: match[0].replace(/\s+/g, ' ').slice(0, 120),
    });
  }
}

if (violations.length > 0) {
  console.error(`check-inline-scripts: found ${violations.length} executable inline script(s) in dist:`);
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}: ${violation.snippet}`);
  }
  console.error('Move each one to public/scripts/ and load it with src="…", or give it a data-block type.');
  process.exit(1);
}

console.log(`check-inline-scripts: OK (${files.length} HTML file(s), no executable inline scripts)`);
