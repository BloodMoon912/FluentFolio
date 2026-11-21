import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, validateMarkdown } from '../scripts/validate-markdown.mjs';

// These tests exercise scripts/validate-markdown.mjs on purpose-built fixture
// trees. The fixtures are a miniature repository (src/content, src/pages,
// public), so the validator runs exactly as it does on the checkout: no mocking
// of its filesystem or route model. CLI exit codes are asserted by spawning the
// real script; everything else asserts the exported validateMarkdown() result.

const SCRIPT = fileURLToPath(new URL('../scripts/validate-markdown.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/invalid-markdown/', import.meta.url));

const temporaryDirectories: string[] = [];

/** Build a throwaway repository tree from a { relativePath: contents } map. */
function makeRepository(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'validate-markdown-'));
  temporaryDirectories.push(root);
  for (const [name, contents] of Object.entries(files)) {
    const file = join(root, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents, 'utf8');
  }
  return root;
}

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  assert.equal(result.error, undefined, `spawning the validator failed: ${String(result.error)}`);
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function warningOnlyContent(): string {
  return [
    '---',
    'title: "Warning only"',
    'description: "This file only produces warnings."',
    'date: 2026-01-06',
    'mysteryKey: true',
    '---',
    '',
    'Body text.',
    '',
  ].join('\n');
}

after(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
});

describe('validate-markdown: invalid fixtures', () => {
  it('finds every intended error and ignores the valid controls', async () => {
    const result = await validateMarkdown({ root: FIXTURES });
    const errors = result.errors;

    const fileIssues = (file: string) =>
      result.issues.filter((issue) => issue.file === `src/content/${file}`).map((issue) => issue.message);
    const hasError = (code: string, fragment: string, file?: string) =>
      errors.some(
        (issue) =>
          issue.code === code &&
          issue.message.includes(fragment) &&
          (file === undefined || issue.file === `src/content/${file}`),
      );

    // Frontmatter: missing block, missing required fields, wrong types, bad date.
    assert.ok(hasError('FM001', 'missing frontmatter block'), 'missing frontmatter is reported');
    assert.ok(hasError('FM005', '"description"', 'blog/bad-required.md'), 'missing required field is reported');
    for (const field of ['title', 'description', 'date', 'tags']) {
      assert.ok(hasError('FM006', `"${field}"`, 'blog/bad-frontmatter.md'), `wrong type for "${field}" is reported`);
    }
    assert.ok(hasError('FM006', 'must be a valid date', 'blog/bad-frontmatter.md'));
    const warning = result.warnings.find((issue) => issue.code === 'FM010' && issue.message.includes('mysteryKey'));
    assert.ok(warning, 'unknown frontmatter key is a warning');

    // Images: absolute (/ -> public/), relative (-> relative to the Markdown file)
    // and inline HTML. External URLs and valid paths must not be reported.
    for (const fragment of ['/images/ghost-cover.png', './ghost-local.png', '/images/ghost-inline.png']) {
      assert.ok(hasError('IMG001', fragment, 'blog/bad-images.md'), `image ${fragment} is reported missing`);
    }
    assert.deepEqual(
      fileIssues('blog/bad-images.md').filter((message) => message.includes('valid-cover')),
      [],
      'valid images are not reported',
    );

    // Links: unknown content routes, unknown static pages and draft targets.
    for (const fragment of ['/posts/blog/ghost-story', '/dictionary/ghost-word', '/missing-page']) {
      assert.ok(hasError('LINK001', fragment, 'blog/dead-links.md'), `dead link ${fragment} is reported`);
    }
    assert.ok(hasError('LINK002', 'draft "draft-post"', 'blog/dead-links.md'), 'draft link is reported');
    const validLinkMessages = fileIssues('blog/dead-links.md').filter(
      (message) =>
        message.includes('/about') ||
        message.includes('/posts/blog/valid-post') ||
        message.includes('/dictionary/valid-word') ||
        message.includes('/images/valid-cover.svg') ||
        message.includes('astro.build'),
    );
    assert.deepEqual(validLinkMessages, [], 'valid links are not reported');

    // Relationships: ghost ids, and the wrong-collection wording when an id
    // exists but belongs to another collection.
    assert.ok(hasError('REF001', 'ghost-lore', 'novel/ghost-refs.md'));
    assert.ok(hasError('REF001', 'ghost-word', 'dictionary/ghost-words.md'));
    assert.ok(hasError('REF001', 'ghost-entry', 'world/ghost-entries.md'));

    // Lore links: [[ghost-word]] warns, [[valid-word]] does not.
    const loreWarnings = result.warnings.filter((issue) => issue.code === 'LORE001');
    assert.deepEqual(
      loreWarnings.map((issue) => issue.message),
      ['[[ghost-word]] is not defined by any published dictionary entry; it renders without a tooltip'],
    );

    // Markdown structure via @lint-md/core.
    const lintRules = errors.filter((issue) => issue.code === 'MDL001').map((issue) => issue.message);
    for (const rule of ['no-empty-url', 'no-empty-list', 'no-empty-blockquote', 'no-empty-code']) {
      assert.ok(
        lintRules.some((message) => message.startsWith(`${rule}:`)),
        `structural lint rule ${rule} is reported`,
      );
    }

    // Negative controls: a fully valid post and dictionary entry produce nothing.
    assert.deepEqual(fileIssues('blog/valid-post.md'), []);
    assert.deepEqual(fileIssues('dictionary/valid-word.md'), []);
  });

  it('promotes warnings to errors only with --strict', async () => {
    const lenient = await validateMarkdown({ root: FIXTURES });
    const strict = await validateMarkdown({ root: FIXTURES, strict: true });

    assert.equal(lenient.warnings.length, 2);
    assert.equal(strict.warnings.length, 0);
    assert.equal(strict.errors.length, lenient.errors.length + lenient.warnings.length);
    assert.ok(strict.errors.every((issue) => issue.level === 'error'));
  });

  it('prints human-readable locations from the CLI and exits non-zero', () => {
    const cli = runCli(['--root', FIXTURES]);
    assert.equal(cli.status, 1);
    assert.match(cli.stderr, /src\/content\/blog\/bad-images\.md:7:1 error IMG001/);
    assert.match(cli.stderr, /src\/content\/blog\/dead-links\.md:\d+:\d+ error LINK001/);
    assert.match(cli.stderr, /error\(s\).*warning\(s\)/);
  });
});

describe('validate-markdown: empty and clean trees', () => {
  it('accepts a repository with no content collections at all', async () => {
    const root = makeRepository({ 'src/pages/index.astro': '---\n---\n' });
    const result = await validateMarkdown({ root });
    assert.equal(result.files, 0);
    assert.deepEqual(result.issues, []);
    assert.match(runCli(['--root', root]).stdout, /nothing to validate/);
  });

  it('accepts empty collection directories', async () => {
    const root = makeRepository({
      'src/content/blog/.gitkeep': '',
      'src/content/novel/.gitkeep': '',
      'src/content/dictionary/.gitkeep': '',
      'src/content/world/.gitkeep': '',
    });
    const result = await validateMarkdown({ root });
    assert.equal(result.files, 0);
    assert.equal(result.errors.length, 0);
    assert.equal(runCli(['--root', root]).status, 0);
  });

  it('exits 0 with warnings by default and 1 under --strict', () => {
    const root = makeRepository({ 'src/content/blog/warning-post.md': warningOnlyContent() });

    const lenient = runCli(['--root', root]);
    assert.equal(lenient.status, 0);
    assert.match(lenient.stderr, /warning FM010 unknown frontmatter field "mysteryKey"/);

    const strict = runCli(['--root', root, '--strict']);
    assert.equal(strict.status, 1);
    assert.match(strict.stderr, /error FM010/);
  });

  it('warns about insecure http:// images but not https:// ones', async () => {
    const root = makeRepository({
      'src/content/blog/http-image.md': [
        '---',
        'title: "Insecure image"',
        'description: "Uses an http image and an https control."',
        'date: 2026-01-07',
        '---',
        '',
        '![insecure](http://example.com/badge.png)',
        '',
        '![secure](https://example.com/badge.png)',
        '',
      ].join('\n'),
    });

    const result = await validateMarkdown({ root });
    const insecure = result.warnings.filter((issue) => issue.code === 'IMG003');
    assert.equal(insecure.length, 1);
    assert.match(insecure[0]?.message ?? '', /insecure http:\/\/ image URL: http:\/\/example\.com\/badge\.png/);
    assert.equal(result.errors.length, 0, 'the http image is a warning, not an error');

    // The warning is promoted by --strict, matching every other warning.
    assert.equal(runCli(['--root', root, '--strict']).status, 1);
  });

  it('exits 2 for an unknown argument and 0 for --help', () => {
    const bad = runCli(['--unknown-flag']);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /unknown argument: --unknown-flag/);

    const help = runCli(['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage: node scripts\/validate-markdown\.mjs/);
  });
});

describe('parseFrontmatter', () => {
  it('parses quoted strings, booleans, integers, block lists and inline lists', () => {
    const parsed = parseFrontmatter(
      [
        '---',
        'title: "A \\"quoted\\" title"',
        'draft: true',
        'chapter: 3',
        'tags:',
        '  - alpha',
        '  - beta',
        'relatedWords: [one, "two, three"]',
        '---',
        'body line',
      ].join('\n'),
    );

    assert.equal(parsed.present, true);
    assert.equal(parsed.data.title, 'A "quoted" title');
    assert.equal(parsed.data.draft, true);
    assert.equal(parsed.data.chapter, 3);
    assert.deepEqual(parsed.data.tags, ['alpha', 'beta']);
    assert.deepEqual(parsed.data.relatedWords, ['one', 'two, three']);
    assert.equal(parsed.body, 'body line');
    assert.equal(parsed.bodyLine, 10);
  });

  it('normalises CRLF input', () => {
    const parsed = parseFrontmatter('---\r\ntitle: "x"\r\n---\r\nbody');
    assert.equal(parsed.data.title, 'x');
    assert.equal(parsed.body, 'body');
    assert.equal(parsed.bodyLine, 4);
  });

  it('reports a missing or unclosed block', () => {
    const missing = parseFrontmatter('# No frontmatter\n\ntext');
    assert.equal(missing.present, false);
    assert.equal(missing.issues[0]?.code, 'FM001');

    const unclosed = parseFrontmatter('---\ntitle: "x"\n\nbody');
    assert.equal(unclosed.present, false);
    assert.equal(unclosed.issues[0]?.code, 'FM002');
  });

  it('reports duplicate keys, empty list items and malformed values', () => {
    const duplicate = parseFrontmatter('---\ntitle: "a"\ntitle: "b"\n---\nbody');
    assert.equal(duplicate.issues[0]?.code, 'FM004');

    const emptyItem = parseFrontmatter('---\ntags:\n  -\n---\nbody');
    assert.equal(emptyItem.issues[0]?.code, 'FM003');

    const unterminated = parseFrontmatter('---\ntitle: "opens\n---\nbody');
    assert.equal(unterminated.issues[0]?.code, 'FM003');
  });
});
