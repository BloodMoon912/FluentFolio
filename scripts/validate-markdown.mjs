#!/usr/bin/env node
// Content integrity validation for the Astro content collections.
//
// `npm run lint` (scripts/lint-markdown.mjs) lints the *prose style* of this
// repository's documentation. This validator is about the opposite problem:
// whether the published content can actually be rendered and navigated. It
// reads src/content/{blog,novel,dictionary,world}/**/*.md and checks:
//
//   1. Frontmatter: the required fields and field types of every collection,
//      mirroring src/content.config.ts. Unknown keys and the removed `pubDate`
//      alias are warnings (Astro silently strips unknown keys, so a typo would
//      otherwise disappear without complaint).
//   2. Images: markdown `![]()` and inline `<img src>` targets. `/…` resolves
//      against public/, relative targets resolve against the Markdown file,
//      http(s)/protocol-relative/data URLs are skipped.
//   3. Internal links: markdown `[]()` and inline `<a href>` targets that start
//      with `/` are checked against the routes this project actually serves
//      (derived from src/pages plus the canonical content routes) and the files
//      under public/. `#fragment` and `?query` suffixes are ignored. Links to
//      draft entries are reported separately, because those pages redirect to
//      /404.
//   4. Relationships: `relatedLore`, `relatedWords` and `relatedEntries` may
//      only reference ids that exist in the collections the rendering pages
//      accept. `[[word]]` lore links are checked against the dictionary keys
//      src/lib/lore-plugin.mjs can resolve (a warning, because undefined words
//      degrade to a plain highlighted span by design).
//   5. Markdown structure: @lint-md/core's structural rules (empty link
//      destination, empty list item, empty blockquote, empty code block, …).
//      See LINT_RULES below for why the typography rules are switched off.
//
// Output is human readable (`file:line:column level CODE message`) and the exit
// code is non-zero when anything is wrong. `--strict` promotes warnings to
// errors; the default mode lets a warning (an advisory) pass so published
// content is never blocked by a stylistic preference.
//
// Empty collections are valid: while content is being migrated, src/content may
// be absent or empty, and `npm run validate:md` must still exit 0.
//
// Usage: node scripts/validate-markdown.mjs [--strict] [--root <dir>]
//
// `--help` prints usage. `--root` exists so tests/validate-markdown.test.ts can
// point the same code at tests/fixtures/invalid-markdown/.

import { existsSync, statSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lintMarkdown, RULE_SEVERITY } from '@lint-md/core';

/**
 * @typedef {'error' | 'warning'} IssueLevel
 *
 * @typedef {'string' | 'number' | 'boolean' | 'string[]' | 'date'} FieldType
 *
 * @typedef {object} FieldSpec
 * @property {FieldType} type
 * @property {boolean} required
 * @property {boolean} [nonEmpty] Required strings and required string lists are rejected when empty.
 * @property {number} [min] Minimum value for integer fields.
 *
 * @typedef {object} FrontmatterIssue
 * @property {string} code
 * @property {number} line
 * @property {number} column
 * @property {string} message
 *
 * @typedef {object} ParsedFrontmatter
 * @property {boolean} present
 * @property {Record<string, unknown>} data
 * @property {Record<string, number>} dataLines 1-based line of each key.
 * @property {string} body
 * @property {number} bodyLine 1-based line number of the first body line.
 * @property {FrontmatterIssue[]} issues
 *
 * @typedef {object} EntryRecord
 * @property {'blog' | 'novel' | 'dictionary' | 'world'} collection
 * @property {string} id Collection id (path without extension, posix separators).
 * @property {string} file Workspace-relative posix path.
 * @property {string} absolutePath
 * @property {Record<string, unknown>} data
 * @property {boolean} draft
 * @property {ParsedFrontmatter} frontmatter
 *
 * @typedef {object} ValidationIssue
 * @property {IssueLevel} level
 * @property {string} code
 * @property {string} file
 * @property {number} [line]
 * @property {number} [column]
 * @property {string} message
 *
 * @typedef {object} RouteModel
 * @property {Set<string>} staticRoutes
 * @property {Set<string>} contentRoutes
 * @property {Map<string, EntryRecord>} draftRoutes
 * @property {RegExp[]} dynamicMatchers
 * @property {Set<string>} publicFiles
 *
 * @typedef {object} ValidateOptions
 * @property {string} [root] Repository root; defaults to this checkout.
 * @property {boolean} [strict] Promote warnings to errors.
 *
 * @typedef {object} ValidateResult
 * @property {string} root
 * @property {number} files Number of Markdown files inspected.
 * @property {EntryRecord[]} entries
 * @property {ValidationIssue[]} issues All findings, sorted.
 * @property {ValidationIssue[]} errors
 * @property {ValidationIssue[]} warnings Always empty after --strict promotion.
 */

/** Repository root, resolved from this file: <root>/scripts/validate-markdown.mjs. */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const CONTENT_DIRECTORY = 'src/content';
const PAGES_DIRECTORY = 'src/pages';
const PUBLIC_DIRECTORY = 'public';

const PAGE_EXTENSIONS = ['.astro', '.md', '.mdx', '.ts', '.js', '.mjs'];

/**
 * Routes that serve content entries even when no page file is present in the
 * tree yet: the URL scheme documented in AGENTS.md. The pages scan below adds
 * every route it finds; these keep the collection checks working while
 * src/pages is being restructured.
 * @type {{ prefix: string, collection: EntryRecord['collection'] }[]}
 */
const CANONICAL_CONTENT_ROUTES = [
  { prefix: '/posts/blog', collection: 'blog' },
  { prefix: '/posts/novel', collection: 'novel' },
  { prefix: '/dictionary', collection: 'dictionary' },
  { prefix: '/world', collection: 'world' },
];

/**
 * Extra page-derived routes: static prefix -> collection. `blog/[slug].astro` is
 * the 301 redirect from the old /blog URLs, so it is only valid while that page
 * exists.
 * @type {Record<string, EntryRecord['collection'] | undefined>}
 */
const PAGE_ROUTE_COLLECTIONS = {
  '/blog': 'blog',
};

/** @type {Record<string, Record<string, FieldSpec>>} */
const COLLECTION_SCHEMAS = {
  blog: {
    title: { type: 'string', required: true, nonEmpty: true },
    date: { type: 'date', required: true },
    description: { type: 'string', required: true, nonEmpty: true },
    type: { type: 'string', required: false },
    updatedDate: { type: 'date', required: false },
    category: { type: 'string', required: false },
    tags: { type: 'string[]', required: false },
    author: { type: 'string', required: false },
    draft: { type: 'boolean', required: false },
    featured: { type: 'boolean', required: false },
  },
  novel: {
    title: { type: 'string', required: true, nonEmpty: true },
    volume: { type: 'string', required: true, nonEmpty: true },
    chapter: { type: 'number', required: true, min: 1 },
    date: { type: 'date', required: true },
    order: { type: 'number', required: true },
    description: { type: 'string', required: false },
    relatedLore: { type: 'string[]', required: false },
    tags: { type: 'string[]', required: false },
    author: { type: 'string', required: false },
    draft: { type: 'boolean', required: false },
  },
  dictionary: {
    word: { type: 'string', required: true, nonEmpty: true },
    partOfSpeech: { type: 'string', required: true, nonEmpty: true },
    definition: { type: 'string', required: true, nonEmpty: true },
    ipa: { type: 'string', required: false },
    etymology: { type: 'string', required: false },
    relatedWords: { type: 'string[]', required: false },
    draft: { type: 'boolean', required: false },
  },
  world: {
    title: { type: 'string', required: true, nonEmpty: true },
    type: { type: 'string', required: true, nonEmpty: true },
    description: { type: 'string', required: true, nonEmpty: true },
    relatedEntries: { type: 'string[]', required: false },
    draft: { type: 'boolean', required: false },
  },
};

/**
 * Relationship field -> collections its ids may point at. These are the sets the
 * rendering pages actually filter against (see the [slug] pages).
 * @type {Record<string, { owner: EntryRecord['collection'], targets: EntryRecord['collection'][], label: string }>}
 */
const RELATION_FIELDS = {
  relatedLore: {
    owner: 'novel',
    targets: ['dictionary', 'world'],
    label: 'dictionary or world',
  },
  relatedWords: {
    owner: 'dictionary',
    targets: ['dictionary'],
    label: 'dictionary',
  },
  relatedEntries: {
    owner: 'world',
    targets: ['world'],
    label: 'world',
  },
};

/** `[[word]]` keys, mirroring src/lib/lore-plugin.mjs: ASCII word only. */
const LORE_LINK_PATTERN = /\[\[([A-Za-z0-9][A-Za-z0-9_-]*)\]\]/g;
const LORE_WORD_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Every rule @lint-md/core 2.5.3 ships. Any rule left out of the config is
 * treated as an ERROR by the library, so the disabled set has to be explicit.
 */
const ALL_LINT_RULES = [
  'correct-title-trailing-punctuation',
  'no-empty-blockquote',
  'no-empty-code',
  'no-empty-code-lang',
  'no-empty-inline-code',
  'no-empty-list',
  'no-empty-url',
  'no-full-width-number',
  'no-half-width-punctuation',
  'no-long-code',
  'no-multiple-blank-lines',
  'no-multiple-space-blockquote',
  'no-space-in-inline-code',
  'no-space-in-link',
  'no-special-characters',
  'require-trailing-spaces',
  'space-around-alphabet',
  'space-around-link',
  'space-around-number',
  'use-standard-ellipsis',
];

/**
 * Only the rules that detect a broken document are enabled. The Chinese
 * typography rules are deliberately off: published posts are authored through
 * the CMS and intentionally contain ASCII punctuation inside CJK prose and
 * ASCII emoticons (see src/content/blog/hello-world.md), and
 * `no-multiple-blank-lines` false-positives on CRLF files in 2.5.3.
 * `no-empty-code-lang` is off as well: it demands a language on *every* fenced
 * block, which is a style rule a plain-text snippet does not have to satisfy.
 * Content style is `npm run lint`'s job, not this validator's.
 */
const STRUCTURAL_LINT_RULES = [
  'no-empty-blockquote',
  'no-empty-code',
  'no-empty-inline-code',
  'no-empty-list',
  'no-empty-url',
];

/** @type {Record<string, import('@lint-md/core').LintMdRuleConfig>} */
const LINT_RULES = {};
for (const rule of ALL_LINT_RULES) LINT_RULES[rule] = RULE_SEVERITY.OFF;
for (const rule of STRUCTURAL_LINT_RULES) LINT_RULES[rule] = RULE_SEVERITY.ERROR;

const USAGE = 'Usage: node scripts/validate-markdown.mjs [--strict] [--root <dir>]';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Convert a native path to posix separators for reporting.
 * @param {string} value
 * @returns {string}
 */
function toPosix(value) {
  return value.split(sep).join('/');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function describeType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'string') return `a string (${JSON.stringify(value)})`;
  if (typeof value === 'number' || typeof value === 'boolean') return `a ${typeof value} (${String(value)})`;
  return typeof value;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isValidDateString(value) {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * @param {unknown} value
 * @param {FieldSpec} spec
 * @returns {string | null} A human-readable problem, or null when the value fits.
 */
function checkFieldType(value, spec) {
  switch (spec.type) {
    case 'string': {
      if (typeof value !== 'string') return `must be a string, got ${describeType(value)}`;
      if (spec.nonEmpty === true && value.trim() === '') return 'must not be empty';
      return null;
    }
    case 'date': {
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'must be a valid date' : null;
      if (typeof value !== 'string') return `must be an ISO date string, got ${describeType(value)}`;
      return isValidDateString(value.trim()) ? null : `must be a valid date (YYYY-MM-DD), got ${JSON.stringify(value)}`;
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return `must be an integer, got ${describeType(value)}`;
      }
      if (spec.min !== undefined && value < spec.min) return `must be >= ${spec.min}`;
      return null;
    }
    case 'boolean': {
      return typeof value === 'boolean' ? null : `must be a boolean (true/false), got ${describeType(value)}`;
    }
    case 'string[]': {
      if (!Array.isArray(value)) return `must be a list, got ${describeType(value)}`;
      for (let index = 0; index < value.length; index += 1) {
        const item = value[index];
        if (typeof item !== 'string') return `item ${index + 1} must be a string, got ${describeType(item)}`;
        if (item.trim() === '') return `item ${index + 1} must not be empty`;
      }
      return null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Frontmatter parsing
//
// A deliberately small YAML subset: the shapes src/content actually stores.
// Anything it does not understand is reported instead of silently ignored,
// which is the whole point: a hand-written parser that skips lines is how a
// missing `description` reaches production.
// ---------------------------------------------------------------------------

/**
 * @param {string} raw
 * @returns {{ value?: unknown, error?: string }}
 */
function parseScalar(raw) {
  const value = raw.trim();
  if (value === '') return { value: '' };
  if (value.startsWith('"')) {
    if (value.length < 2 || !value.endsWith('"')) return { error: 'unterminated double-quoted string' };
    try {
      return { value: JSON.parse(value) };
    } catch {
      return { value: value.slice(1, -1) };
    }
  }
  if (value.startsWith("'")) {
    if (value.length < 2 || !value.endsWith("'")) return { error: 'unterminated single-quoted string' };
    return { value: value.slice(1, -1).replace(/''/g, "'") };
  }
  const commentIndex = value.indexOf(' #');
  const plain = (commentIndex === -1 ? value : value.slice(0, commentIndex)).trim();
  if (plain === 'true') return { value: true };
  if (plain === 'false') return { value: false };
  if (plain === 'null' || plain === '~') return { value: null };
  if (/^-?\d+(?:\.\d+)?$/.test(plain)) {
    const number = Number(plain);
    if (Number.isFinite(number)) return { value: number };
  }
  return { value: plain };
}

/**
 * @param {string} raw Starts with "[".
 * @returns {{ value?: unknown[], error?: string }}
 */
function parseInlineList(raw) {
  if (!raw.endsWith(']')) return { error: 'inline list is missing its closing "]"' };
  const inner = raw.slice(1, -1).trim();
  if (inner === '') return { value: [] };
  /** @type {string[]} */
  const parts = [];
  let current = '';
  let quote = '';
  let depth = 0;
  for (const character of inner) {
    if (quote !== '') {
      current += character;
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === '[' || character === '{') depth += 1;
    if (character === ']' || character === '}') depth -= 1;
    if (character === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  parts.push(current);
  /** @type {unknown[]} */
  const values = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const parsed = parseScalar(trimmed);
    if (parsed.error !== undefined) return { error: parsed.error };
    values.push(parsed.value);
  }
  return { value: values };
}

/**
 * @param {string} raw
 * @returns {ParsedFrontmatter}
 */
export function parseFrontmatter(raw) {
  /** @type {FrontmatterIssue[]} */
  const issues = [];
  const text = raw.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  const firstLine = lines[0] ?? '';

  if (!/^---\s*$/.test(firstLine)) {
    issues.push({
      code: 'FM001',
      line: 1,
      column: 1,
      message: 'missing frontmatter block: the file must start with "---"',
    });
    return { present: false, data: {}, dataLines: {}, body: text, bodyLine: 1, issues };
  }

  let closeIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (/^(?:---|\.\.\.)\s*$/.test(lines[index] ?? '')) {
      closeIndex = index;
      break;
    }
  }
  if (closeIndex === -1) {
    issues.push({
      code: 'FM002',
      line: 1,
      column: 1,
      message: 'unclosed frontmatter block: no closing "---" line found',
    });
    return { present: false, data: {}, dataLines: {}, body: '', bodyLine: lines.length + 1, issues };
  }

  /** @type {Record<string, unknown>} */
  const data = {};
  /** @type {Record<string, number>} */
  const dataLines = {};
  /** @type {string | null} */
  let currentListKey = null;

  for (let index = 1; index < closeIndex; index += 1) {
    const line = lines[index] ?? '';
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const leading = line.match(/^(\s*)/)?.[1] ?? '';
    if (leading.includes('\t')) {
      issues.push({
        code: 'FM003',
        line: lineNumber,
        column: 1,
        message: 'tabs are not allowed in frontmatter indentation',
      });
      continue;
    }

    const listItem = /^\s*-\s*(.*)$/.exec(line);
    if (listItem !== null) {
      if (currentListKey === null) {
        issues.push({ code: 'FM003', line: lineNumber, column: 1, message: 'list item without a parent key' });
        continue;
      }
      const rest = listItem[1] ?? '';
      if (rest.trim() === '') {
        issues.push({
          code: 'FM003',
          line: lineNumber,
          column: 1,
          message: `empty list item under "${currentListKey}"`,
        });
        continue;
      }
      const parsed = parseScalar(rest);
      if (parsed.error !== undefined) {
        issues.push({ code: 'FM003', line: lineNumber, column: 1, message: parsed.error });
        continue;
      }
      const list = data[currentListKey];
      if (Array.isArray(list)) list.push(parsed.value);
      continue;
    }

    const keyMatch = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (keyMatch === null) {
      issues.push({
        code: 'FM003',
        line: lineNumber,
        column: 1,
        message: `unexpected frontmatter syntax: ${JSON.stringify(trimmed)}`,
      });
      continue;
    }

    const key = keyMatch[1] ?? '';
    const restRaw = keyMatch[2] ?? '';
    if (dataLines[key] !== undefined) {
      issues.push({ code: 'FM004', line: lineNumber, column: 1, message: `duplicate frontmatter key "${key}"` });
      continue;
    }
    dataLines[key] = lineNumber;
    currentListKey = null;
    const rest = restRaw.trim();

    if (/^[|>][+-]?$/.test(rest)) {
      /** @type {string[]} */
      const collected = [];
      let cursor = index + 1;
      while (cursor < closeIndex) {
        const candidate = lines[cursor] ?? '';
        if (candidate.trim() === '' || /^\s/.test(candidate)) {
          collected.push(candidate);
          cursor += 1;
          continue;
        }
        break;
      }
      while (collected.length > 0 && (collected[collected.length - 1] ?? '').trim() === '') collected.pop();
      const indents = collected
        .filter((candidate) => candidate.trim() !== '')
        .map((candidate) => (candidate.match(/^(\s*)/)?.[1] ?? '').length);
      const dedent = indents.length > 0 ? Math.min(...indents) : 0;
      const values = collected.map((candidate) => candidate.slice(dedent));
      data[key] = rest.startsWith('>') ? values.join(' ').replace(/\s+/g, ' ').trim() : values.join('\n');
      index = cursor - 1;
      continue;
    }

    if (rest === '') {
      data[key] = [];
      currentListKey = key;
      continue;
    }
    if (rest.startsWith('[')) {
      const parsed = parseInlineList(rest);
      if (parsed.error !== undefined) {
        issues.push({ code: 'FM003', line: lineNumber, column: 1, message: parsed.error });
        continue;
      }
      data[key] = parsed.value ?? [];
      continue;
    }
    if (rest.startsWith('{')) {
      issues.push({
        code: 'FM003',
        line: lineNumber,
        column: 1,
        message: `inline mapping for "${key}" is not supported; the content collections never use it`,
      });
      data[key] = rest;
      continue;
    }

    const parsed = parseScalar(rest);
    if (parsed.error !== undefined) {
      issues.push({ code: 'FM003', line: lineNumber, column: 1, message: parsed.error });
      continue;
    }
    data[key] = parsed.value;
  }

  const body = lines.slice(closeIndex + 1).join('\n');
  return { present: true, data, dataLines, body, bodyLine: closeIndex + 2, issues };
}

// ---------------------------------------------------------------------------
// Filesystem discovery
// ---------------------------------------------------------------------------

/**
 * @param {string} directory
 * @returns {Promise<string[]>} Regular files below the directory, sorted.
 */
async function listFilesRecursive(directory) {
  /** @type {string[]} */
  const files = [];
  /** @type {string[]} */
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    /** @type {import('node:fs').Dirent[]} */
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      if (entry.isFile()) files.push(fullPath);
    }
  }
  return files.sort(compareStrings);
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isRegularFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * @param {string} root
 * @returns {Promise<EntryRecord[]>}
 */
async function discoverEntries(root) {
  /** @type {EntryRecord[]} */
  const entries = [];
  for (const collection of Object.keys(COLLECTION_SCHEMAS)) {
    const base = join(root, CONTENT_DIRECTORY, collection);
    if (!existsSync(base)) continue;
    const files = await listFilesRecursive(base);
    for (const absolutePath of files) {
      if (!absolutePath.toLowerCase().endsWith('.md')) continue;
      const id = toPosix(relative(base, absolutePath)).replace(/\.md$/i, '');
      const file = toPosix(relative(root, absolutePath));
      const collectionName = /** @type {EntryRecord['collection']} */ (collection);
      /** @type {EntryRecord} */
      let entry;
      try {
        const raw = await readFile(absolutePath, 'utf8');
        const frontmatter = parseFrontmatter(raw);
        entry = {
          collection: collectionName,
          id,
          file,
          absolutePath,
          data: frontmatter.data,
          draft: frontmatter.data.draft === true,
          frontmatter,
        };
      } catch (error) {
        entry = {
          collection: collectionName,
          id,
          file,
          absolutePath,
          data: {},
          draft: false,
          frontmatter: {
            present: false,
            data: {},
            dataLines: {},
            body: '',
            bodyLine: 1,
            issues: [
              {
                code: 'IO001',
                line: 1,
                column: 1,
                message: `cannot read file: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          },
        };
      }
      entries.push(entry);
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Route model
// ---------------------------------------------------------------------------

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} segment
 * @returns {string}
 */
function segmentToRegExp(segment) {
  let result = '';
  let cursor = 0;
  const pattern = /\[(\.\.\.)?([A-Za-z0-9_]+)\]/g;
  let match;
  while ((match = pattern.exec(segment)) !== null) {
    result += escapeRegExp(segment.slice(cursor, match.index));
    result += match[1] === '...' ? '(?:[^/]+(?:/[^/]+)*)' : '[^/]+';
    cursor = match.index + match[0].length;
  }
  result += escapeRegExp(segment.slice(cursor));
  return result;
}

/**
 * @param {string} pageFile Page path relative to src/pages, posix separators.
 * @returns {string | null} Route pattern, or null for error pages.
 */
function routeFromPageFile(pageFile) {
  let route = pageFile;
  const extension = PAGE_EXTENSIONS.find((candidate) => route.toLowerCase().endsWith(candidate));
  if (extension === undefined) return null;
  route = route.slice(0, -extension.length);
  const segments = route.split('/').filter((segment) => segment !== '');
  if (segments[segments.length - 1] === 'index') segments.pop();
  if (segments.length === 1 && (segments[0] === '404' || segments[0] === '500')) return null;
  return '/' + segments.join('/');
}

/**
 * @param {string} root
 * @param {EntryRecord[]} entries
 * @returns {Promise<RouteModel>}
 */
async function buildRouteModel(root, entries) {
  /** @type {RouteModel} */
  const model = {
    staticRoutes: new Set(['/']),
    contentRoutes: new Set(),
    draftRoutes: new Map(),
    dynamicMatchers: [],
    publicFiles: new Set(),
  };

  /**
   * @param {string} prefix
   * @param {EntryRecord['collection']} collection
   */
  function addContentRoutes(prefix, collection) {
    for (const entry of entries) {
      if (entry.collection !== collection) continue;
      const route = `${prefix}/${entry.id}`;
      if (entry.draft) model.draftRoutes.set(route, entry);
      else model.contentRoutes.add(route);
    }
  }

  for (const mapping of CANONICAL_CONTENT_ROUTES) addContentRoutes(mapping.prefix, mapping.collection);

  const pagesDirectory = join(root, PAGES_DIRECTORY);
  if (existsSync(pagesDirectory)) {
    const pageFiles = await listFilesRecursive(pagesDirectory);
    for (const pageFile of pageFiles) {
      const route = routeFromPageFile(toPosix(relative(pagesDirectory, pageFile)));
      if (route === null) continue;
      const parts = route.split('/').filter((segment) => segment !== '');
      const firstDynamic = parts.findIndex((segment) => segment.includes('['));
      if (firstDynamic === -1) {
        model.staticRoutes.add(route);
        continue;
      }
      const prefixKey = parts.slice(0, firstDynamic).join('/');
      const prefix = firstDynamic === 0 ? '' : `/${prefixKey}`;
      const mapping = PAGE_ROUTE_COLLECTIONS[prefix];
      const dynamicParts = parts.filter((segment) => /^\[[^\]]+\]$/.test(segment));
      const simpleCollectionRoute =
        mapping !== undefined && dynamicParts.length === 1 && firstDynamic === parts.length - 1;
      if (simpleCollectionRoute) {
        addContentRoutes(prefix, mapping);
        continue;
      }
      const pattern = parts.map((segment) => segmentToRegExp(segment)).join('/');
      model.dynamicMatchers.push(new RegExp(`^/${pattern}/?$`));
    }
  }

  const publicDirectory = join(root, PUBLIC_DIRECTORY);
  if (existsSync(publicDirectory)) {
    for (const publicFile of await listFilesRecursive(publicDirectory)) {
      model.publicFiles.add('/' + toPosix(relative(publicDirectory, publicFile)));
    }
  }

  return model;
}

/**
 * @param {string} value
 * @returns {string}
 */
function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * @param {string} path
 * @returns {string}
 */
function normalizeRoutePath(path) {
  let normalized = safeDecode(path);
  if (!normalized.startsWith('/')) normalized = `/${normalized}`;
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
}

/**
 * @param {RouteModel} model
 * @param {string} path
 * @returns {{ status: 'ok' } | { status: 'draft', entry: EntryRecord } | { status: 'missing' }}
 */
function resolveInternalTarget(model, path) {
  if (model.staticRoutes.has(path) || model.contentRoutes.has(path) || model.publicFiles.has(path)) {
    return { status: 'ok' };
  }
  const draft = model.draftRoutes.get(path);
  if (draft !== undefined) return { status: 'draft', entry: draft };
  for (const matcher of model.dynamicMatchers) {
    if (matcher.test(path)) return { status: 'ok' };
  }
  return { status: 'missing' };
}

// ---------------------------------------------------------------------------
// Markdown scanning helpers
// ---------------------------------------------------------------------------

/**
 * Blank out fenced code blocks, inline code spans and HTML comments while
 * preserving character offsets and line breaks, so links and images inside code
 * samples are neither reported nor silently treated as real content.
 * @param {string} text
 * @returns {string}
 */
function maskCodeRegions(text) {
  const lines = text.split('\n');
  /** @type {string[]} */
  const masked = [];
  /** @type {{ char: string, length: number } | null} */
  let fence = null;
  let inComment = false;
  for (const line of lines) {
    if (fence !== null) {
      masked.push(' '.repeat(line.length));
      const closing = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
      if (closing !== null) {
        const marker = closing[1] ?? '';
        if (marker.startsWith(fence.char) && marker.length >= fence.length) fence = null;
      }
      continue;
    }
    if (inComment) {
      masked.push(' '.repeat(line.length));
      if (line.includes('-->')) inComment = false;
      continue;
    }
    const opening = /^\s*(`{3,}|~{3,})/.exec(line);
    if (opening !== null) {
      const marker = opening[1] ?? '```';
      fence = { char: marker.charAt(0), length: marker.length };
      masked.push(' '.repeat(line.length));
      continue;
    }
    const commentStart = line.indexOf('<!--');
    if (commentStart !== -1 && line.indexOf('-->', commentStart) === -1) {
      inComment = true;
      masked.push(' '.repeat(line.length));
      continue;
    }
    let remaining = line.replace(/<!--[\s\S]*?-->/g, (match) => ' '.repeat(match.length));
    remaining = remaining.replace(/`[^`]*`/g, (match) => ' '.repeat(match.length));
    masked.push(remaining);
  }
  return masked.join('\n');
}

/**
 * @param {string} text
 * @returns {number[]}
 */
function buildLineStarts(text) {
  /** @type {number[]} */
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

/**
 * @param {number[]} lineStarts
 * @param {number} index
 * @returns {{ line: number, column: number }}
 */
function offsetToPosition(lineStarts, index) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((lineStarts[middle] ?? 0) <= index) low = middle;
    else high = middle - 1;
  }
  return { line: low + 1, column: index - (lineStarts[low] ?? 0) + 1 };
}

/**
 * Read the destination of `[text](…)` / `![alt](…)` starting at the "(" index.
 * @param {string} text
 * @param {number} openParenIndex
 * @returns {{ target: string, targetIndex: number, endIndex: number } | null}
 */
function readInlineDestination(text, openParenIndex) {
  let index = openParenIndex + 1;
  while (index < text.length && /\s/.test(text.charAt(index))) index += 1;
  if (index >= text.length) return null;
  if (text.charAt(index) === '<') {
    const close = text.indexOf('>', index + 1);
    if (close === -1) return null;
    return { target: text.slice(index + 1, close), targetIndex: index + 1, endIndex: close };
  }
  let depth = 0;
  let cursor = index;
  for (; cursor < text.length; cursor += 1) {
    const character = text.charAt(cursor);
    if (character === '(') {
      depth += 1;
      continue;
    }
    if (character === ')') {
      if (depth === 0) break;
      depth -= 1;
      continue;
    }
    if (/\s/.test(character) && depth === 0) break;
  }
  let closing = text.indexOf(')', cursor);
  if (closing === -1) closing = cursor;
  return {
    target: text.slice(index, cursor).trim(),
    targetIndex: index,
    endIndex: closing,
  };
}

/**
 * @param {string} tag Raw HTML tag text.
 * @param {string} name Attribute name (lower case).
 * @returns {string | null} Attribute value.
 */
function readAttribute(tag, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const match = pattern.exec(tag);
  if (match === null) return null;
  return match[1] ?? match[2] ?? match[3] ?? '';
}

/**
 * @param {string} raw
 * @returns {string | null} The target when it has a scheme or is protocol-relative.
 */
function externalTarget(raw) {
  const target = raw.trim();
  if (target.startsWith('//')) return target;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) return target;
  return null;
}

/**
 * Split a link target into path/query/fragment.
 * @param {string} target
 * @returns {{ path: string, fragment: string }}
 */
function splitTarget(target) {
  let path = target;
  let fragment = '';
  const hashIndex = path.indexOf('#');
  if (hashIndex !== -1) {
    fragment = path.slice(hashIndex + 1);
    path = path.slice(0, hashIndex);
  }
  const queryIndex = path.indexOf('?');
  if (queryIndex !== -1) path = path.slice(0, queryIndex);
  return { path, fragment };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * @param {ValidationIssue[]} issues
 * @param {IssueLevel} level
 * @param {string} code
 * @param {string} file
 * @param {number | undefined} line
 * @param {number | undefined} column
 * @param {string} message
 */
function pushIssue(issues, level, code, file, line, column, message) {
  issues.push({ level, code, file, line, column, message });
}

/**
 * @param {EntryRecord} entry
 * @param {ValidationIssue[]} issues
 */
function validateFrontmatter(entry, issues) {
  const { file } = entry;
  const parsed = entry.frontmatter;
  for (const issue of parsed.issues) {
    pushIssue(issues, 'error', issue.code, file, issue.line, issue.column, issue.message);
  }
  if (!parsed.present) return;

  const schema = COLLECTION_SCHEMAS[entry.collection];
  const data = entry.data;

  for (const key of Object.keys(data)) {
    if (Object.prototype.hasOwnProperty.call(schema, key)) continue;
    if (key === 'pubDate') {
      pushIssue(
        issues,
        'warning',
        'FM011',
        file,
        1,
        1,
        'frontmatter field "pubDate" was renamed to "date" and is ignored; use "date"',
      );
      continue;
    }
    pushIssue(
      issues,
      'warning',
      'FM010',
      file,
      parsed.dataLines[key] ?? 1,
      1,
      `unknown frontmatter field "${key}" for the "${entry.collection}" collection; Astro drops it`,
    );
  }

  for (const [field, spec] of Object.entries(schema)) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) {
      if (spec.required) {
        pushIssue(
          issues,
          'error',
          'FM005',
          file,
          1,
          1,
          `missing required frontmatter field "${field}" for the "${entry.collection}" collection`,
        );
      }
      continue;
    }
    const problem = checkFieldType(data[field], spec);
    if (problem !== null) {
      pushIssue(
        issues,
        'error',
        'FM006',
        file,
        parsed.dataLines[field] ?? 1,
        1,
        `frontmatter field "${field}" ${problem}`,
      );
    }
  }
}

/**
 * @param {EntryRecord} entry
 * @param {EntryRecord[]} entries
 * @param {ValidationIssue[]} issues
 */
function validateRelations(entry, entries, issues) {
  /** @type {Record<string, Set<string>>} */
  const idsByCollection = {};
  for (const collection of Object.keys(COLLECTION_SCHEMAS)) idsByCollection[collection] = new Set();
  for (const candidate of entries) idsByCollection[candidate.collection].add(candidate.id);

  for (const [field, relation] of Object.entries(RELATION_FIELDS)) {
    if (entry.collection !== relation.owner) continue;
    const value = entry.data[field];
    if (!Array.isArray(value)) continue;
    const line = entry.frontmatter.dataLines[field] ?? 1;
    for (const target of value) {
      if (typeof target !== 'string' || target.trim() === '') continue;
      const id = target.trim();
      const accepted = relation.targets.some((collection) => idsByCollection[collection].has(id));
      if (accepted) continue;
      const wrongCollection = Object.keys(idsByCollection).find(
        (collection) =>
          !relation.targets.includes(/** @type {EntryRecord['collection']} */ (collection)) &&
          idsByCollection[collection].has(id),
      );
      if (wrongCollection !== undefined) {
        pushIssue(
          issues,
          'error',
          'REF002',
          entry.file,
          line,
          1,
          `${field} references "${id}", which is a ${wrongCollection} entry; only ${relation.label} entries are accepted here`,
        );
        continue;
      }
      pushIssue(
        issues,
        'error',
        'REF001',
        entry.file,
        line,
        1,
        `${field} references unknown id "${id}" (no ${relation.label} entry with that id)`,
      );
    }
  }
}

/**
 * The keys src/lib/lore-plugin.mjs can resolve: filename stem, linkable id and
 * linkable frontmatter `word` of every published dictionary entry with a
 * definition.
 * @param {EntryRecord[]} entries
 * @returns {Set<string>}
 */
function collectLoreKeys(entries) {
  /** @type {Set<string>} */
  const keys = new Set();
  for (const entry of entries) {
    if (entry.collection !== 'dictionary' || entry.draft) continue;
    const definition = entry.data.definition;
    if (typeof definition !== 'string' || definition.trim() === '') continue;
    const slash = entry.id.lastIndexOf('/');
    const stem = slash === -1 ? entry.id : entry.id.slice(slash + 1);
    if (LORE_WORD_PATTERN.test(stem)) keys.add(stem);
    if (LORE_WORD_PATTERN.test(entry.id)) keys.add(entry.id);
    const word = entry.data.word;
    if (typeof word === 'string' && LORE_WORD_PATTERN.test(word)) keys.add(word);
  }
  return keys;
}

/**
 * Structural markdown lint via @lint-md/core. The library reports positions
 * relative to the text it is given, so the body offset is added back.
 * @param {EntryRecord} entry
 * @param {ValidationIssue[]} issues
 */
function lintMarkdownBody(entry, issues) {
  const { body, bodyLine } = entry.frontmatter;
  /** @type {import('@lint-md/core').LintMarkdownResult} */
  let result;
  try {
    result = lintMarkdown(body, { rules: LINT_RULES });
  } catch (error) {
    pushIssue(
      issues,
      'error',
      'MDL002',
      entry.file,
      bodyLine,
      1,
      `markdown linter failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  for (const diagnostic of result.diagnostics) {
    pushIssue(
      issues,
      'error',
      'MDL001',
      entry.file,
      bodyLine + diagnostic.line - 1,
      diagnostic.column,
      `${diagnostic.ruleId}: ${diagnostic.message}`,
    );
  }
  for (const executionError of result.executionErrors) {
    pushIssue(
      issues,
      'error',
      'MDL002',
      entry.file,
      bodyLine,
      1,
      `markdown rule ${executionError.ruleName} failed: ${executionError.message}`,
    );
  }
}

/**
 * @param {string} target Raw target (possibly wrapped in "<…>").
 * @param {EntryRecord} entry
 * @param {RouteModel} model
 * @param {ValidationIssue[]} issues
 * @param {number} line
 * @param {number} column
 */
function checkImageTarget(target, entry, model, issues, line, column) {
  const raw = target.trim().replace(/^<|>$/g, '').trim();
  if (raw === '') {
    pushIssue(issues, 'error', 'IMG002', entry.file, line, column, 'image has an empty source');
    return;
  }
  const external = externalTarget(raw);
  if (external !== null) {
    // External images are not fetched, but an `http://` image is a mixed-content
    // problem on an HTTPS site (and often a dead link). Warn instead of erroring
    // so legacy content can be migrated without breaking the build.
    if (/^http:/i.test(external)) {
      pushIssue(
        issues,
        'warning',
        'IMG003',
        entry.file,
        line,
        column,
        `insecure http:// image URL: ${raw} (use https://)`,
      );
    }
    return;
  }
  const { path } = splitTarget(raw);
  if (path === '') {
    pushIssue(issues, 'error', 'IMG002', entry.file, line, column, `image source "${raw}" has no file path`);
    return;
  }
  const decoded = safeDecode(path);
  if (decoded.startsWith('/')) {
    const normalized = normalizeRoutePath(decoded);
    if (model.publicFiles.has(normalized)) return;
    if (resolveInternalTarget(model, normalized).status === 'ok') return;
    pushIssue(
      issues,
      'error',
      'IMG001',
      entry.file,
      line,
      column,
      `image not found: ${raw} (no file under public/ and no matching route)`,
    );
    return;
  }
  if (!isRegularFile(resolve(dirname(entry.absolutePath), decoded))) {
    pushIssue(
      issues,
      'error',
      'IMG001',
      entry.file,
      line,
      column,
      `image not found: ${raw} (resolved relative to ${entry.file})`,
    );
  }
}

/**
 * @param {string} target Raw target (possibly wrapped in "<…>").
 * @param {EntryRecord} entry
 * @param {RouteModel} model
 * @param {ValidationIssue[]} issues
 * @param {number} line
 * @param {number} column
 */
function checkLinkTarget(target, entry, model, issues, line, column) {
  const raw = target.trim().replace(/^<|>$/g, '').trim();
  if (raw === '') return; // Empty destinations are reported by the markdown linter.
  if (externalTarget(raw) !== null) return;
  const { path } = splitTarget(raw);
  if (path === '') return; // Same-page anchor or query-only link.
  const decoded = safeDecode(path);
  if (!decoded.startsWith('/')) return; // Relative links are not route-checked.
  const normalized = normalizeRoutePath(decoded);
  const resolution = resolveInternalTarget(model, normalized);
  if (resolution.status === 'ok') return;
  if (resolution.status === 'draft') {
    pushIssue(
      issues,
      'error',
      'LINK002',
      entry.file,
      line,
      column,
      `link points at unpublished ${resolution.entry.collection} draft "${resolution.entry.id}": ${raw}`,
    );
    return;
  }
  pushIssue(
    issues,
    'error',
    'LINK001',
    entry.file,
    line,
    column,
    `dead internal link: ${raw} (no page route and no file under public/ matches)`,
  );
}

/**
 * @param {EntryRecord} entry
 * @param {RouteModel} model
 * @param {Set<string>} loreKeys
 * @param {ValidationIssue[]} issues
 */
function validateBody(entry, model, loreKeys, issues) {
  const { body, bodyLine } = entry.frontmatter;
  if (body.trim() === '') {
    pushIssue(issues, 'warning', 'BODY001', entry.file, bodyLine, 1, 'Markdown body is empty');
  }

  const masked = maskCodeRegions(body);
  const lineStarts = buildLineStarts(masked);
  /**
   * @param {number} index
   * @returns {{ line: number, column: number }}
   */
  function filePosition(index) {
    const position = offsetToPosition(lineStarts, index);
    return { line: bodyLine + position.line - 1, column: position.column };
  }

  const markdownPattern = /(!?)\[([^[\]\n]*)\]\(/g;
  let match;
  while ((match = markdownPattern.exec(masked)) !== null) {
    const isImage = match[1] === '!';
    const openParenIndex = match.index + match[0].length - 1;
    const destination = readInlineDestination(masked, openParenIndex);
    if (destination === null) continue;
    markdownPattern.lastIndex = destination.endIndex + 1;
    const position = filePosition(match.index);
    if (isImage) checkImageTarget(destination.target, entry, model, issues, position.line, position.column);
    else checkLinkTarget(destination.target, entry, model, issues, position.line, position.column);
  }

  const htmlImagePattern = /<img\b[^>]*>/gi;
  while ((match = htmlImagePattern.exec(masked)) !== null) {
    const source = readAttribute(match[0], 'src');
    if (source === null) continue;
    const position = filePosition(match.index);
    checkImageTarget(source, entry, model, issues, position.line, position.column);
  }

  const htmlLinkPattern = /<a\b[^>]*>/gi;
  while ((match = htmlLinkPattern.exec(masked)) !== null) {
    const href = readAttribute(match[0], 'href');
    if (href === null) continue;
    const position = filePosition(match.index);
    checkLinkTarget(href, entry, model, issues, position.line, position.column);
  }

  const lorePattern = new RegExp(LORE_LINK_PATTERN.source, 'g');
  while ((match = lorePattern.exec(masked)) !== null) {
    const word = match[1] ?? '';
    if (loreKeys.has(word)) continue;
    const position = filePosition(match.index);
    pushIssue(
      issues,
      'warning',
      'LORE001',
      entry.file,
      position.line,
      position.column,
      `[[${word}]] is not defined by any published dictionary entry; it renders without a tooltip`,
    );
  }

  lintMarkdownBody(entry, issues);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * @param {ValidateOptions} [options]
 * @returns {Promise<ValidateResult>}
 */
export async function validateMarkdown(options = {}) {
  const root = resolve(options.root ?? REPO_ROOT);
  if (!existsSync(root)) throw new Error(`root directory does not exist: ${root}`);

  const entries = await discoverEntries(root);
  const model = await buildRouteModel(root, entries);
  const loreKeys = collectLoreKeys(entries);
  /** @type {ValidationIssue[]} */
  const issues = [];

  for (const entry of entries) {
    validateFrontmatter(entry, issues);
    validateRelations(entry, entries, issues);
    validateBody(entry, model, loreKeys, issues);
  }

  issues.sort(
    (left, right) =>
      compareStrings(left.file, right.file) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      (left.column ?? 0) - (right.column ?? 0) ||
      compareStrings(left.code, right.code),
  );

  if (options.strict === true) {
    for (const issue of issues) issue.level = 'error';
  }

  return {
    root,
    files: entries.length,
    entries,
    issues,
    errors: issues.filter((issue) => issue.level === 'error'),
    warnings: issues.filter((issue) => issue.level === 'warning'),
  };
}

/**
 * @param {string[]} argv
 * @returns {{ root: string | undefined, strict: boolean, help: boolean }}
 */
function parseArguments(argv) {
  /** @type {{ root: string | undefined, strict: boolean, help: boolean }} */
  const parsed = { root: undefined, strict: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    if (argument === '--strict') {
      parsed.strict = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      parsed.help = true;
      continue;
    }
    if (argument === '--root') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error('--root requires a directory argument');
      }
      parsed.root = value;
      index += 1;
      continue;
    }
    if (argument.startsWith('--root=')) {
      parsed.root = argument.slice('--root='.length);
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  return parsed;
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>} Process exit code.
 */
async function runCli(argv) {
  /** @type {{ root: string | undefined, strict: boolean, help: boolean }} */
  let parsed;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    console.error(`validate-markdown: ${error instanceof Error ? error.message : String(error)}`);
    console.error(USAGE);
    return 2;
  }
  if (parsed.help) {
    console.log(USAGE);
    console.log('');
    console.log('Checks frontmatter, images, internal links, relationship ids and markdown structure');
    console.log('for src/content/{blog,novel,dictionary,world}/**/*.md.');
    console.log('');
    console.log('  --strict   Treat warnings (unknown fields, undefined [[word]] links, empty bodies) as errors.');
    console.log('  --root     Validate a different repository root. Defaults to this checkout.');
    return 0;
  }

  /** @type {ValidateResult} */
  let result;
  try {
    result = await validateMarkdown({ root: parsed.root, strict: parsed.strict });
  } catch (error) {
    console.error(`validate-markdown: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  for (const issue of result.issues) {
    const location = issue.line === undefined ? issue.file : `${issue.file}:${issue.line}:${issue.column ?? 1}`;
    console.error(`${location} ${issue.level} ${issue.code} ${issue.message}`);
  }

  if (result.files === 0) {
    console.log('validate-markdown: no Markdown content files found under src/content; nothing to validate.');
    return 0;
  }
  if (result.errors.length > 0) {
    console.error(
      `\nvalidate-markdown: ${result.errors.length} error(s), ${result.warnings.length} warning(s) in ${result.files} file(s).`,
    );
    return 1;
  }
  if (result.warnings.length > 0) {
    console.log(`validate-markdown: ${result.files} file(s) checked, ${result.warnings.length} warning(s), no errors.`);
    return 0;
  }
  console.log(`validate-markdown: ${result.files} file(s) clean.`);
  return 0;
}

const entryScript = process.argv[1];
const invokedDirectly = entryScript !== undefined && pathToFileURL(resolve(entryScript)).href === import.meta.url;

if (invokedDirectly) {
  process.exitCode = await runCli(process.argv.slice(2));
}
