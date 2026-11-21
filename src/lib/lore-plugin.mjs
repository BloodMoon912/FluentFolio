// Sätteri mdast plugin: turns `[[word]]` into a span that already carries the
// definition it needs.
//
// Astro 7's default Markdown processor is Sätteri, not unified/remark, so this
// is a Sätteri plugin (a visitor object), wired through
// `markdown.processor: satteri({ mdastPlugins: [loreLinksPlugin] })` in
// astro.config.mjs.
//
// Markdown authors write:   This mentions [[test-word]].
// It becomes:               <span class="lore-word" data-lore-word="test-word"
//                                 data-tooltip="definition" tabindex="0">test-word</span>
//
// The dictionary is read with `node:fs` **once per build** while the processor
// renders Markdown, and the definition is inlined as a `data-tooltip` attribute.
// The client therefore never calls an API for a tooltip: /lore.json is gone.
//
// `node:fs` is safe here because this module is only ever executed by the Node
// build/dev process when Sätteri renders Markdown into the content data layer.
// The rendered HTML is what ships in `dist/`; no Worker request path imports
// this file's fs reader.
//
// The `text` visitor is the right hook: mdast text nodes never appear inside
// code blocks or inline code (those nodes carry a `value` instead), so code
// samples containing [[...]] are left untouched.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `[[word]]` — ASCII word only, so prose brackets and CJK never match. */
const PATTERN = /\[\[([A-Za-z0-9][A-Za-z0-9_-]*)\]\]/g;

/** A dictionary entry id / word is linkable only in this shape. */
const WORD_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** The default dictionary root, resolved from this file: src/content/dictionary. */
const DEFAULT_DICTIONARY_DIRECTORY = fileURLToPath(new URL('../content/dictionary/', import.meta.url));

/**
 * Definitions change while `astro dev` is running, so the lazily-built lookup
 * is refreshed when it is older than this. During a production build the
 * dictionary does not change, so this merely re-stats a handful of files.
 */
const CACHE_TTL_MS = 1000;

/**
 * Minimal front-matter reader for the dictionary collection. The repository
 * deliberately has no YAML dependency (see `src/lib/frontmatter.ts`), and only
 * three keys are needed here: `word`, `definition` and `draft`.
 *
 * Handles the scalar shapes the collection actually stores: double-quoted
 * (JSON-style) strings, single-quoted strings, plain scalars, booleans, and
 * `|` / `>` block scalars.
 *
 * @param {string} raw
 * @returns {Record<string, string | boolean>}
 */
function parseFrontmatter(raw) {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return {};

  /** @type {Record<string, string | boolean>} */
  const data = {};
  const lines = match[1].split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;

    const pair = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!pair) continue;

    const [, key, remainder] = pair;
    const value = remainder.trim();

    if (/^[|>][+-]?$/.test(value)) {
      // Block scalar: collect the indented (or blank) lines that follow.
      const folded = value.startsWith('>');
      /** @type {string[]} */
      const block = [];
      while (index + 1 < lines.length) {
        const next = lines[index + 1];
        if (next.trim() !== '' && !/^\s/.test(next)) break;
        block.push(next.replace(/^\s+/, ''));
        index += 1;
      }
      data[key] = (folded ? block.join(' ') : block.join('\n')).trim();
      continue;
    }

    data[key] = parseScalar(value);
  }

  return data;
}

/**
 * @param {string} value
 * @returns {string | boolean}
 */
function parseScalar(value) {
  if (value === '') return '';
  if (value === 'true') return true;
  if (value === 'false') return false;

  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
  }

  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }

  return value;
}

/**
 * @param {string} directory
 * @returns {string[]}
 */
function listMarkdownFiles(directory) {
  /** @type {import('node:fs').Dirent[]} */
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    // A checkout without mock dictionary content still has to build.
    return [];
  }

  /** @type {string[]} */
  const files = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listMarkdownFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(fullPath);
  }
  return files;
}

/**
 * Build the build-time word -> definition map from
 * `src/content/dictionary/**\/*.md`. Draft entries are skipped, as is any entry
 * without a definition. Each entry is addressable by its filename stem and, when
 * that differs and is linkable, its collection id and front-matter `word`.
 * Keys that `[[...]]` cannot express (slashes, spaces, CJK) are ignored.
 *
 * @param {string} [directory]
 * @returns {Map<string, string>}
 */
export function loadLoreDefinitions(directory = DEFAULT_DICTIONARY_DIRECTORY) {
  /** @type {Map<string, string>} */
  const definitions = new Map();

  for (const file of listMarkdownFiles(directory)) {
    /** @type {Record<string, string | boolean>} */
    let frontmatter;
    try {
      frontmatter = parseFrontmatter(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }

    if (frontmatter.draft === true) continue;
    if (typeof frontmatter.definition !== 'string') continue;

    const definition = frontmatter.definition.trim();
    if (definition === '') continue;

    const id = relative(directory, file).split(sep).join('/').replace(/\.md$/, '');
    const slash = id.lastIndexOf('/');
    const stem = slash === -1 ? id : id.slice(slash + 1);

    /** @type {string[]} */
    const keys = [stem, id];
    const word = typeof frontmatter.word === 'string' ? frontmatter.word.trim() : '';
    if (word !== '' && word !== stem) keys.push(word);

    for (const key of keys) {
      if (WORD_PATTERN.test(key)) definitions.set(key, definition);
    }
  }

  return definitions;
}

/** @type {Map<string, string> | null} */
let cachedDefinitions = null;
let cachedAt = 0;

/** @returns {Map<string, string>} */
function defaultDefinitions() {
  const now = Date.now();
  if (cachedDefinitions === null || now - cachedAt > CACHE_TTL_MS) {
    cachedDefinitions = loadLoreDefinitions();
    cachedAt = now;
  }
  return cachedDefinitions;
}

/**
 * Create the mdast visitor. The definitions map is injected so tests can run
 * without touching the real dictionary directory.
 *
 * @param {() => Map<string, string>} getDefinitions
 * @returns {import('satteri').MdastPluginDefinition}
 */
export function createLoreLinksPlugin(getDefinitions) {
  return {
    name: 'lore-links',

    /** @param {import('satteri').MdastNode & { value?: string }} node
     *  @param {import('satteri').MdastVisitorContext} ctx */
    text(node, ctx) {
      const value = node.value;
      if (typeof value !== 'string' || !value.includes('[[')) return;

      /** @type {Map<string, string> | null} */
      let definitions = null;
      const parts = [];
      let cursor = 0;
      let match;

      // A fresh regex per node keeps `lastIndex` from leaking between calls.
      const re = new RegExp(PATTERN);
      while ((match = re.exec(value)) !== null) {
        if (match.index > cursor) parts.push({ type: 'text', value: value.slice(cursor, match.index) });

        const word = match[1];
        if (definitions === null) definitions = getDefinitions();
        const definition = definitions.get(word);

        /** @type {Record<string, string | number | string[]>} */
        const properties = {
          className: ['lore-word'],
          'data-lore-word': word,
        };
        if (definition !== undefined) properties['data-tooltip'] = definition;
        else properties['data-lore-missing'] = '';
        properties.tabIndex = 0;

        parts.push({
          type: 'loreWord',
          // A custom node with children + data.hName renders an element; the
          // hProperties become its HTML attributes (escaped by the serializer).
          children: [{ type: 'text', value: word }],
          data: {
            hName: 'span',
            hProperties: properties,
          },
        });

        cursor = match.index + match[0].length;
      }

      if (parts.length === 0) return;
      if (cursor < value.length) parts.push({ type: 'text', value: value.slice(cursor) });

      ctx.replaceNode(node, parts);
    },
  };
}

/** The plugin Astro wires up: resolves definitions from the dictionary on use. */
export const loreLinksPlugin = createLoreLinksPlugin(defaultDefinitions);

export default loreLinksPlugin;
