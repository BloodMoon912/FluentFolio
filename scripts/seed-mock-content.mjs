#!/usr/bin/env node
// Seed or remove the mock content used for local development.
//
// The five entries under `tests/fixtures/mock-content/` are copies of the
// placeholder posts that used to sit in `src/content/`. Real content is authored
// through the admin CMS, so those files do not belong in the published
// collections — but a fresh checkout still needs one entry per collection for
// the reading routes to render anything.
//
// Usage:
//   node scripts/seed-mock-content.mjs --seed    copy fixtures -> src/content
//   node scripts/seed-mock-content.mjs --clean   remove only the fixture files
//
// `--clean` is driven by MANIFEST below, never by a directory scan: a real post
// can never be deleted by accident, and the directories themselves are kept.

import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE_ROOT = join(ROOT, 'tests', 'fixtures', 'mock-content');
const CONTENT_ROOT = join(ROOT, 'src', 'content');

/**
 * Whitelist of entries the script may write (`--seed`) or delete (`--clean`).
 * Paths are relative to both roots, with `/` separators.
 */
const MANIFEST = [
  'blog/test-post.md',
  'novel/test-chapter-01.md',
  'novel/test-chapter-02.md',
  'dictionary/test-word.md',
  'world/test-entry.md',
];

const USAGE = `Usage: node scripts/seed-mock-content.mjs <--seed|--clean>

  --seed   copy tests/fixtures/mock-content/** into src/content/**
  --clean  delete the fixture entries listed in the script from src/content`;

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} relativePath */
function sourcePath(relativePath) {
  return join(FIXTURE_ROOT, ...relativePath.split('/'));
}

/** @param {string} relativePath */
function targetPath(relativePath) {
  return join(CONTENT_ROOT, ...relativePath.split('/'));
}

async function seed() {
  const copied = [];
  const missing = [];
  for (const relativePath of MANIFEST) {
    const source = sourcePath(relativePath);
    if (!(await exists(source))) {
      missing.push(relativePath);
      continue;
    }
    const target = targetPath(relativePath);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
    copied.push(relativePath);
  }

  for (const relativePath of copied) console.log(`  seeded  ${relativePath}`);
  for (const relativePath of missing) console.error(`  missing  ${relativePath}`);
  console.log(`seed-mock-content: seeded ${copied.length}/${MANIFEST.length} entry/entries into src/content.`);
  if (missing.length > 0) process.exitCode = 1;
}

async function clean() {
  const removed = [];
  const absent = [];
  for (const relativePath of MANIFEST) {
    const target = targetPath(relativePath);
    if (!(await exists(target))) {
      absent.push(relativePath);
      continue;
    }
    await rm(target);
    removed.push(relativePath);
  }

  for (const relativePath of removed) console.log(`  removed  ${relativePath}`);
  console.log(`seed-mock-content: removed ${removed.length}/${MANIFEST.length} mock entry/entries from src/content.`);
  if (absent.length > 0) {
    console.log(`seed-mock-content: ${absent.length} entry/entries were already absent.`);
  }
}

const mode = process.argv[2];
if (mode === '--seed') {
  await seed();
} else if (mode === '--clean') {
  await clean();
} else {
  console.error(USAGE);
  process.exitCode = 1;
}
