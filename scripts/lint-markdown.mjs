#!/usr/bin/env node
// Markdown lint for this repository's own documentation.
//
// Reuses the `markdownlint` package that is already a direct dependency (the
// admin CMS loads the same library in the browser), so `npm run lint` needs no
// new package and no network access.
//
// The rule set is deliberately small and high-signal. The default markdownlint
// set flags deliberate choices these docs have made (long lines, inline HTML,
// repeated emphasis) which would bury the real problems.

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint } from 'markdownlint/promise';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Directories that never contain hand-written documentation. `content` holds
 * published blog posts: those are authored through the admin CMS, which already
 * runs markdownlint interactively, and a docs linter must not reformat posts
 * that have already shipped.
 */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.astro', '.wrangler', '.opencode', '.git', 'content']);

/**
 * Imported reference material rather than this project's own documentation. The
 * Fluent design spec deliberately gives every numbered section its own H1, which
 * is exactly what MD001/MD025 exist to flag; excluding it keeps those rules
 * useful for the docs we are responsible for.
 */
const SKIP_FILES = new Set(['Fluent_UI_Design_Motion_Guidelines_for_Astro.md']);

/** @type {import('markdownlint').Configuration} */
const CONFIG = {
  default: false,
  MD001: true, // heading levels increase by one at a time
  MD003: { style: 'atx' }, // ATX headings only ('#', not underlines)
  MD009: true, // no trailing spaces
  MD010: true, // no hard tabs
  MD012: { maximum: 1 }, // no multiple consecutive blank lines
  MD018: true, // exactly one space after the hash in a heading
  MD019: true, // no multiple spaces after the hash
  MD022: true, // headings surrounded by blank lines
  MD023: true, // headings start at the beginning of the line
  MD025: true, // exactly one top-level heading per document
  MD031: true, // fenced code blocks surrounded by blank lines
  MD032: true, // lists surrounded by blank lines
  MD047: true, // file ends with a single newline
};

/** @param {string} dir @returns {Promise<string[]>} */
async function collectMarkdown(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      found.push(...(await collectMarkdown(join(dir, entry.name))));
      continue;
    }
    if (entry.name.endsWith('.md') && !SKIP_FILES.has(entry.name)) found.push(join(dir, entry.name));
  }
  return found;
}

const files = (await collectMarkdown(ROOT)).sort();

if (files.length === 0) {
  console.error('lint-markdown: no Markdown files found.');
  process.exit(1);
}

/** @type {Record<string, string>} */
const strings = {};
for (const file of files) {
  strings[relative(ROOT, file).split(sep).join('/')] = await readFile(file, 'utf8');
}

const results = await lint({ strings, config: CONFIG });

let problemCount = 0;
for (const [name, problems] of Object.entries(results)) {
  if (!Array.isArray(problems) || problems.length === 0) continue;
  problemCount += problems.length;
  for (const problem of problems) {
    console.error(
      `${name}:${problem.lineNumber}:${problem.errorRange?.[0] ?? 0} ${problem.ruleNames.join('/')} ${problem.ruleDescription}`,
    );
  }
}

if (problemCount > 0) {
  console.error(`\nlint-markdown: ${problemCount} problem(s) in ${files.length} file(s).`);
  process.exit(1);
}

console.log(`lint-markdown: ${files.length} file(s) clean.`);
