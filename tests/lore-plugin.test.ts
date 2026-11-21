import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { createLoreLinksPlugin, loadLoreDefinitions } from '../src/lib/lore-plugin.mjs';

// The plugin is a plain visitor object, so it can be exercised without booting
// Sätteri: hand it a text node and a fake context, then inspect the nodes it
// asks the pipeline to splice in. Definitions are injected, so the unit tests
// do not depend on whatever mock dictionary content is in the checkout; the
// fs loader gets its own temp-directory fixtures.

interface Part {
  type: string;
  value?: string;
  children?: Part[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
}

type Visitor = (
  node: { type: 'text'; value: string },
  context: { replaceNode: (node: unknown, replacement: Part[]) => void },
) => void;

function makeVisitor(definitions: Map<string, string>): Visitor {
  const plugin = createLoreLinksPlugin(() => definitions);
  return plugin.text as unknown as Visitor;
}

function run(value: string, definitions = new Map<string, string>()): Part[] {
  const calls: Part[][] = [];
  makeVisitor(definitions)(
    { type: 'text', value },
    {
      replaceNode(_node: unknown, replacement: Part[]) {
        calls.push(replacement);
      },
    },
  );
  assert.ok(calls.length <= 1, 'one replacement per text node');
  return calls[0] ?? [];
}

function spans(parts: Part[]): Part[] {
  return parts.filter((part) => part.data?.hName === 'span');
}

describe('loreLinksPlugin', () => {
  it('inlines a defined word as data-tooltip on the span', () => {
    const definitions = new Map([['test-word', '這是測試釋義。']]);
    const parts = run('see [[test-word]] here', definitions);

    assert.equal(parts.length, 3);
    assert.deepEqual(parts[0], { type: 'text', value: 'see ' });
    assert.deepEqual(parts[2], { type: 'text', value: ' here' });

    const span = spans(parts)[0];
    assert.ok(span, 'a span was spliced in');
    assert.deepEqual(span.children, [{ type: 'text', value: 'test-word' }]);
    assert.equal(span.data?.hName, 'span');
    assert.deepEqual(span.data?.hProperties?.className, ['lore-word']);
    assert.equal(span.data?.hProperties?.['data-lore-word'], 'test-word');
    assert.equal(span.data?.hProperties?.['data-tooltip'], '這是測試釋義。');
    assert.equal(span.data?.hProperties?.tabIndex, 0);
    assert.equal('data-lore-missing' in (span.data?.hProperties ?? {}), false);
  });

  it('leaves an undefined word as a span with data-lore-missing and no tooltip', () => {
    const span = spans(run('see [[test-unknown]] here'))[0];
    assert.ok(span, 'an undefined word still renders a span');

    const properties = span.data?.hProperties ?? {};
    assert.equal(properties['data-lore-word'], 'test-unknown');
    assert.equal('data-tooltip' in properties, false);
    assert.equal(properties['data-lore-missing'], '');
  });

  it('keeps a definition with HTML/quotes verbatim in the attribute value', () => {
    const definition = 'A "quoted" <b>definition</b> & more';
    const span = spans(run('[[test-word]]', new Map([['test-word', definition]])))[0];
    assert.equal(span?.data?.hProperties?.['data-tooltip'], definition);
  });

  it('handles multiple tokens in one text node', () => {
    const definitions = new Map([
      ['test-word', '第一'],
      ['test-word-two', '第二'],
    ]);
    const parts = run('[[test-word]] and [[test-word-two]]', definitions);
    assert.deepEqual(
      spans(parts).map((part) => part.data?.hProperties?.['data-lore-word']),
      ['test-word', 'test-word-two'],
    );
    assert.deepEqual(
      spans(parts).map((part) => part.data?.hProperties?.['data-tooltip']),
      ['第一', '第二'],
    );
  });

  it('leaves text without tokens untouched', () => {
    assert.deepEqual(run('plain text'), []);
  });

  it('ignores malformed tokens', () => {
    assert.deepEqual(run('[[ two words ]] and [[trailing'), []);
  });

  it('only visits text nodes, so code and inline code are never rewritten', () => {
    const plugin = createLoreLinksPlugin(() => new Map());
    // mdast code / inlineCode nodes reach a `code` / `inlineCode` visitor, not
    // `text`; with no such visitor the `[[...]]` sample stays literal.
    assert.deepEqual(Object.keys(plugin).sort(), ['name', 'text']);
  });
});

describe('loadLoreDefinitions', () => {
  const fixtures: string[] = [];

  after(() => {
    for (const directory of fixtures) rmSync(directory, { recursive: true, force: true });
  });

  function fixtureDirectory(files: Record<string, string>): string {
    const directory = mkdtempSync(join(tmpdir(), 'lore-plugin-'));
    fixtures.push(directory);
    for (const [name, contents] of Object.entries(files)) {
      const file = join(directory, name);
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, contents, 'utf8');
    }
    return directory;
  }

  it('maps word, id and filename stem to the definition', () => {
    const directory = fixtureDirectory({
      'test-word.md': ['---', 'word: test-word', 'definition: "這是測試釋義。"', '---', ''].join('\n'),
      'nested/test-word-two.md': ['---', 'word: test-word-two', 'definition: 這是測試釋義二。', '---', ''].join('\n'),
      'aliased.md': ['---', 'word: test-alias', 'definition: "測試別名。"', '---', ''].join('\n'),
    });

    const definitions = loadLoreDefinitions(directory);
    assert.equal(definitions.get('test-word'), '這是測試釋義。');
    // A nested collection id contains `/`, which `[[...]]` cannot express; the
    // filename stem is the linkable key instead.
    assert.equal(definitions.has('nested/test-word-two'), false);
    assert.equal(definitions.get('test-word-two'), '這是測試釋義二。');
    assert.equal(definitions.get('aliased'), '測試別名。');
    assert.equal(definitions.get('test-alias'), '測試別名。');
  });

  it('skips drafts, missing definitions, and non-linkable keys', () => {
    const directory = fixtureDirectory({
      'draft.md': ['---', 'word: test-draft', 'definition: "草稿。"', 'draft: true', '---', ''].join('\n'),
      'no-definition.md': ['---', 'word: test-no-definition', '---', ''].join('\n'),
      'not-a-word.md': ['---', 'word: 這是中文', 'definition: "中文詞。"', '---', ''].join('\n'),
    });

    const definitions = loadLoreDefinitions(directory);
    assert.equal(definitions.has('draft'), false);
    assert.equal(definitions.has('test-draft'), false);
    assert.equal(definitions.has('no-definition'), false);
    assert.equal(definitions.has('這是中文'), false);
  });

  it('returns an empty map for a missing directory', () => {
    const definitions = loadLoreDefinitions(join(tmpdir(), 'lore-plugin-does-not-exist'));
    assert.equal(definitions.size, 0);
  });

  it('reads quoted, single-quoted and block-scalar definitions', () => {
    const directory = fixtureDirectory({
      'test-double.md': ['---', 'word: test-double', 'definition: "測試「引號」。"', '---', ''].join('\n'),
      'test-single.md': ['---', 'word: test-single', "definition: '測試單引號。'", '---', ''].join('\n'),
      'test-block.md': ['---', 'word: test-block', 'definition: |', '  測試區塊。', '---', ''].join('\n'),
    });

    const definitions = loadLoreDefinitions(directory);
    assert.equal(definitions.get('test-double'), '測試「引號」。');
    assert.equal(definitions.get('test-single'), '測試單引號。');
    assert.equal(definitions.get('test-block'), '測試區塊。');
  });
});
