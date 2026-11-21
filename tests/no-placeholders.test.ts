// Guards the pages that are prerendered and can never be fixed at request time:
// a `<待填>` placeholder that reaches `src/pages` or `src/i18n` would be baked
// into the public HTML. docs/ placeholders are draft material and are excluded.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCAN_DIRS = ['src/pages', 'src/i18n'];
const PLACEHOLDER = '<待填>';

function filesUnder(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

test('no <待填> placeholder is left in public pages or i18n strings', () => {
  const hits: string[] = [];
  for (const relativeDir of SCAN_DIRS) {
    for (const file of filesUnder(join(ROOT, relativeDir))) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (line.includes(PLACEHOLDER)) {
          hits.push(`${relative(ROOT, file)}:${index + 1}: ${line.trim()}`);
        }
      });
    }
  }

  assert.deepEqual(
    hits,
    [],
    `Found ${hits.length} placeholder(s); replace them with real data before shipping:\n${hits.join('\n')}`,
  );
});
