#!/usr/bin/env node
// Decode an invisible watermark from text on stdin and match it against every
// protected entry. Usage:
//
//   WATERMARK_SECRET=... node scripts/decode-watermark.mjs < suspicious.txt
//   pbpaste | WATERMARK_SECRET=... node scripts/decode-watermark.mjs
//
// Prints the matched `collection/id` keys, or an explicit "not found".

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeRuns, findMatches, signatureKey } from '../src/lib/watermark-core.mjs';

const secret = process.env.WATERMARK_SECRET;
if (!secret) {
  console.error('decode-watermark: WATERMARK_SECRET is not set.');
  process.exit(1);
}

const contentRoot = fileURLToPath(new URL('../src/content/', import.meta.url));
const PROTECTED = ['novel', 'dictionary', 'world'];

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  /** @type {string[]} */
  let files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files = files.concat(walk(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full);
  }
  return files;
}

function entryKeys() {
  const keys = [];
  for (const collection of PROTECTED) {
    const dir = join(contentRoot, collection);
    let files;
    try {
      files = walk(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      const id = relative(dir, file).replace(/\\/g, '/').replace(/\.md$/, '');
      keys.push(signatureKey(collection, id));
    }
  }
  return keys;
}

const text = readFileSync(0, 'utf8');
const chunks = decodeRuns(text);
if (chunks.length === 0) {
  console.log('未找到浮水印：輸入文字中沒有零寬字元簽章。');
  process.exit(0);
}

const matches = findMatches(secret, entryKeys(), text);
if (matches.length === 0) {
  console.log(`找到 ${chunks.length} 組零寬字元，但沒有符合目前內容的簽章。`);
  console.log('可能原因：簽章來自其他站點、密鑰不同，或文字已被改寫。');
  process.exit(0);
}

console.log(`找到 ${matches.length} 個可能的來源：`);
for (const key of matches) console.log(`  - ${key}`);
