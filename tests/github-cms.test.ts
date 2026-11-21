import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GithubCmsError,
  REST_LIST_CONCURRENCY,
  commitFileChanges,
  listAllContentWithFrontmatter,
  listAllPostsWithFrontmatter,
  type FileChange,
  type GithubContext,
} from '../src/lib/github-cms-core.ts';

const ENV = { GITHUB_TOKEN: 'test-token', GITHUB_REPO: 'owner/repo', GITHUB_BRANCH: 'main' };

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

type FetchHandler = (call: FetchCall) => Response | Promise<Response>;

/** A `GithubContext` whose `fetch` records calls and delegates to `handler`. */
function fakeContext(handler: FetchHandler): { context: GithubContext; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const context: GithubContext = {
    env: ENV,
    fetch: async (input, init) => {
      const call: FetchCall = {
        url: input,
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === 'string' ? init.body : undefined,
      };
      calls.push(call);
      return handler(call);
    },
  };
  return { context, calls };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function b64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

function markdown(title: string): string {
  return `---\ntitle: ${title}\ndate: 2026-01-02\ncategory: 隨筆\ntags:\n  - test\ndraft: false\n---\n\nBody of ${title}.\n`;
}

interface GraphqlEntry {
  name: string;
  type?: string;
  oid?: string | null;
  text?: string | null;
}

/** A successful GraphQL directory payload; `oid` defaults to `sha-<name>`. */
function graphqlDirectory(entries: GraphqlEntry[], typename = 'Tree'): Response {
  return json({
    data: {
      repository: {
        object: {
          __typename: typename,
          entries: entries.map((entry) => ({
            name: entry.name,
            type: entry.type ?? 'blob',
            object: { __typename: 'Blob', oid: entry.oid ?? `sha-${entry.name}`, text: entry.text ?? null },
          })),
        },
      },
    },
  });
}

const isGraphql = (call: FetchCall) => call.url === 'https://api.github.com/graphql';
const isDirectoryList = (call: FetchCall) =>
  call.method === 'GET' && call.url.includes('/contents/src/content/') && !call.url.includes('.md?ref=');

interface CommitFailureOptions {
  failBlob?: boolean;
  failTree?: boolean;
  failCommit?: boolean;
  /** Status to answer the final ref PATCH with; omit for success. */
  refStatus?: number;
  refDetail?: string;
}

/**
 * Fake GitHub Git Data API for `commitFileChanges` (a single commit = read ref,
 * read commit/tree, upload blobs, create tree, create commit, move ref), with
 * optional failure injection at each step.
 */
function fakeCommitContext(options: CommitFailureOptions = {}) {
  return fakeContext((call) => {
    if (call.method === 'GET' && call.url.endsWith('/git/ref/heads/main')) {
      return json({ object: { sha: 'base-commit' } });
    }
    if (call.method === 'GET' && call.url.endsWith('/git/commits/base-commit')) {
      return json({ tree: { sha: 'base-tree' } });
    }
    if (call.method === 'POST' && call.url.endsWith('/git/blobs')) {
      return options.failBlob ? new Response('blob failed', { status: 500 }) : json({ sha: 'blob-new' });
    }
    if (call.method === 'POST' && call.url.endsWith('/git/trees')) {
      return options.failTree ? new Response('tree failed', { status: 422 }) : json({ sha: 'tree-new' });
    }
    if (call.method === 'POST' && call.url.endsWith('/git/commits')) {
      return options.failCommit ? new Response('commit failed', { status: 500 }) : json({ sha: 'commit-new' });
    }
    if (call.method === 'PATCH' && call.url.endsWith('/git/refs/heads/main')) {
      if (options.refStatus) return new Response(options.refDetail ?? 'ref failed', { status: options.refStatus });
      return json({ object: { sha: 'commit-new' } });
    }
    return new Response(`unexpected ${call.method} ${call.url}`, { status: 500 });
  });
}

function requestBody(call: FetchCall | undefined): Record<string, unknown> {
  return JSON.parse(call?.body ?? '{}') as Record<string, unknown>;
}

const refPatches = (calls: FetchCall[]) =>
  calls.filter((call) => call.method === 'PATCH' && call.url.endsWith('/git/refs/heads/main'));

describe('listAllPostsWithFrontmatter — GraphQL success', () => {
  it('reads the whole directory with a single GraphQL query', async () => {
    const { context, calls } = fakeContext((call) => {
      assert.ok(isGraphql(call));
      return graphqlDirectory([
        { name: 'first.md', text: markdown('First') },
        { name: 'second.md', oid: 'blob-2', text: markdown('Second') },
        // Non-markdown and directory entries must be filtered out client-side.
        { name: 'cover.png', type: 'blob', text: null },
        { name: 'subdir', type: 'tree' },
      ]);
    });

    const posts = await listAllPostsWithFrontmatter(context);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.method, 'POST');
    assert.equal(calls[0]?.headers.Authorization, 'Bearer test-token');
    assert.deepEqual(Object.keys(posts[0] ?? {}).sort(), ['body', 'data', 'sha', 'slug']);

    assert.deepEqual(
      posts.map((post) => ({ slug: post.slug, sha: post.sha, title: post.data.title, tags: post.data.tags })),
      [
        { slug: 'first', sha: 'sha-first.md', title: 'First', tags: ['test'] },
        { slug: 'second', sha: 'blob-2', title: 'Second', tags: ['test'] },
      ],
    );
    assert.equal(posts[0]?.body.trim(), 'Body of First.');

    const request = JSON.parse(calls[0]?.body ?? '{}') as {
      query: string;
      variables: Record<string, string>;
    };
    assert.match(request.query, /object\(expression: \$expression\)/);
    assert.match(request.query, /\.\.\. on Blob\s*\{\s*oid\s+text\s*\}/);
    assert.deepEqual(request.variables, {
      owner: 'owner',
      name: 'repo',
      expression: 'main:src/content/blog',
    });
  });

  it('treats a missing directory as an empty collection without a REST retry', async () => {
    const { context, calls } = fakeContext(() => json({ data: { repository: { object: null } } }));

    assert.deepEqual(await listAllPostsWithFrontmatter(context), []);
    assert.equal(calls.length, 1);
  });
});

describe('listAllPostsWithFrontmatter — GraphQL fallback', () => {
  it('uses the REST listing when GraphQL returns errors', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const { context, calls } = fakeContext((call) => {
      if (isGraphql(call)) return json({ errors: [{ message: 'API rate limit exceeded' }] });
      if (isDirectoryList(call)) {
        return json([{ name: 'rest-post.md', path: 'src/content/blog/rest-post.md', sha: 'sha-rest', type: 'file' }]);
      }
      return json({ sha: 'sha-rest', content: b64(markdown('From REST')) });
    });

    const posts = await listAllPostsWithFrontmatter(context);

    assert.deepEqual(
      posts.map((post) => ({ slug: post.slug, sha: post.sha, title: post.data.title })),
      [{ slug: 'rest-post', sha: 'sha-rest', title: 'From REST' }],
    );
    assert.equal(calls.length, 3);
    assert.ok(isGraphql(calls[0] as FetchCall));
    assert.equal(calls[1]?.url, 'https://api.github.com/repos/owner/repo/contents/src/content/blog?ref=main');
    assert.equal(
      calls[2]?.url,
      'https://api.github.com/repos/owner/repo/contents/src/content/blog/rest-post.md?ref=main',
    );
  });

  it('falls back when the GraphQL HTTP request fails or a blob has no text', async (t) => {
    t.mock.method(console, 'warn', () => {});
    for (const graphqlResponse of [
      () => new Response('{"message":"Not Found"}', { status: 404 }),
      () => graphqlDirectory([{ name: 'binary.md', text: null }]),
    ]) {
      const { context, calls } = fakeContext((call) => {
        if (isGraphql(call)) return graphqlResponse();
        if (isDirectoryList(call)) {
          return json([{ name: 'a.md', path: 'src/content/blog/a.md', sha: 'sha-a', type: 'file' }]);
        }
        return json({ sha: 'sha-a', content: b64(markdown('A')) });
      });

      const posts = await listAllPostsWithFrontmatter(context);
      assert.deepEqual(
        posts.map((post) => post.slug),
        ['a'],
      );
      assert.equal(calls.length, 3);
    }
  });

  it('returns [] when both GraphQL and the REST listing are 404', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const { context, calls } = fakeContext((call) =>
      isGraphql(call) ? new Response('', { status: 502 }) : new Response('', { status: 404 }),
    );

    assert.deepEqual(await listAllPostsWithFrontmatter(context), []);
    // GraphQL attempt + one REST directory listing, no per-file requests.
    assert.equal(calls.length, 2);
    assert.ok(isDirectoryList(calls[1] as FetchCall));
  });

  it('bounds the REST fallback concurrency', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const names = Array.from({ length: 10 }, (_, index) => `post-${index}.md`);
    let inFlight = 0;
    let maxInFlight = 0;
    const { context, calls } = fakeContext(async (call) => {
      if (isGraphql(call)) return json({ errors: [{ message: 'unavailable' }] });
      if (isDirectoryList(call)) {
        return json(
          names.map((name) => ({ name, path: `src/content/blog/${name}`, sha: `sha-${name}`, type: 'file' })),
        );
      }
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      const slug =
        call.url
          .split('/')
          .pop()
          ?.replace(/\.md\?ref=main$/, '') ?? '';
      return json({ sha: `sha-${slug}.md`, content: b64(markdown(slug)) });
    });

    const posts = await listAllPostsWithFrontmatter(context);

    assert.deepEqual(
      posts.map((post) => post.slug),
      names.map((name) => name.replace(/\.md$/, '')),
    );
    assert.ok(maxInFlight <= REST_LIST_CONCURRENCY, `expected <= ${REST_LIST_CONCURRENCY}, saw ${maxInFlight}`);
    assert.ok(maxInFlight > 1, 'the fallback should still run requests in parallel');
    assert.equal(calls.length, 2 + names.length);
  });
});

describe('listAllContentWithFrontmatter', () => {
  it('queries the requested collection directory and keeps its entry shape', async () => {
    const { context, calls } = fakeContext((call) => {
      assert.ok(isGraphql(call));
      return graphqlDirectory([{ name: 'chapter-1.md', oid: 'blob-c1', text: markdown('Chapter 1') }]);
    });

    const entries = await listAllContentWithFrontmatter(context, 'novel');

    const request = JSON.parse(calls[0]?.body ?? '{}') as { variables: Record<string, string> };
    assert.equal(request.variables.expression, 'main:src/content/novel');
    assert.deepEqual(Object.keys(entries[0] ?? {}).sort(), ['body', 'collection', 'data', 'id', 'sha']);
    assert.equal(entries[0]?.collection, 'novel');
    assert.equal(entries[0]?.id, 'chapter-1');
    assert.equal(entries[0]?.sha, 'blob-c1');
  });
});

describe('configuration errors', () => {
  it('fails fast with a 503 when the CMS bindings are missing, without any request', async () => {
    const calls: FetchCall[] = [];
    const context: GithubContext = {
      env: {},
      fetch: async (input, init) => {
        calls.push({ url: input, method: init?.method ?? 'GET', headers: {}, body: undefined });
        return new Response('');
      },
    };

    await assert.rejects(listAllPostsWithFrontmatter(context), (error: unknown) => {
      assert.ok(error instanceof GithubCmsError);
      assert.equal(error.status, 503);
      return true;
    });
    assert.equal(calls.length, 0);
  });
});

describe('commitFileChanges', () => {
  it('commits a write and a delete in one tree/commit and moves the ref once', async () => {
    const { context, calls } = fakeCommitContext();
    const changes: FileChange[] = [
      { path: 'src/content/blog/new-post.md', content: markdown('New Post') },
      { path: 'src/content/blog/old-post.md', content: null },
    ];

    const result = await commitFileChanges(context, changes, 'batch: publish + delete');

    assert.deepEqual(result, { commitSha: 'commit-new' });

    const blobCalls = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/git/blobs'));
    const treeCalls = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/git/trees'));
    const commitCalls = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/git/commits'));

    assert.equal(blobCalls.length, 1, 'a delete must not upload a blob');
    assert.equal(treeCalls.length, 1);
    assert.equal(commitCalls.length, 1, 'the whole batch is a single commit');
    assert.equal(refPatches(calls).length, 1, 'one ref move = one push / one Workers Build');

    const blob = requestBody(blobCalls[0]);
    assert.equal(blob.encoding, 'base64');
    assert.equal(Buffer.from(String(blob.content), 'base64').toString('utf8'), markdown('New Post'));

    // The delete is a tree entry with an explicit `sha: null`, in change order.
    assert.deepEqual(requestBody(treeCalls[0]), {
      base_tree: 'base-tree',
      tree: [
        { path: 'src/content/blog/new-post.md', mode: '100644', type: 'blob', sha: 'blob-new' },
        { path: 'src/content/blog/old-post.md', mode: '100644', type: 'blob', sha: null },
      ],
    });
    assert.deepEqual(requestBody(commitCalls[0]), {
      message: 'batch: publish + delete',
      tree: 'tree-new',
      parents: ['base-commit'],
    });
    assert.deepEqual(requestBody(refPatches(calls)[0]), { sha: 'commit-new', force: false });
  });

  it('maps a 409 or 422 ref update rejection to GithubCmsError 409 with the retry hint', async () => {
    for (const refStatus of [409, 422]) {
      const { context, calls } = fakeCommitContext({ refStatus, refDetail: 'Update is not a fast forward' });

      await assert.rejects(
        commitFileChanges(context, [{ path: 'src/content/blog/a.md', content: markdown('A') }], 'batch'),
        (error: unknown) => {
          assert.ok(error instanceof GithubCmsError);
          assert.equal(error.status, 409);
          assert.match(error.message, new RegExp(`update ref failed: ${refStatus}`));
          assert.match(error.message, /Update is not a fast forward/);
          assert.match(error.message, /retry the batch operation/);
          return true;
        },
      );

      // The commit was built before the ref move failed; the ref is not retried.
      assert.equal(refPatches(calls).length, 1);
    }
  });

  it('is a no-op for an empty change list, without touching the network', async () => {
    const { context, calls } = fakeCommitContext();

    assert.equal(await commitFileChanges(context, [], 'batch'), null);
    assert.equal(calls.length, 0);
  });

  it('maps blob/tree/commit failures to GithubCmsError 502 without moving the ref', async () => {
    const cases: Array<{ options: CommitFailureOptions; message: RegExp }> = [
      { options: { failBlob: true }, message: /create blob failed: 500/ },
      { options: { failTree: true }, message: /create tree failed: 422/ },
      { options: { failCommit: true }, message: /create commit failed: 500/ },
    ];

    for (const testCase of cases) {
      const { context, calls } = fakeCommitContext(testCase.options);

      await assert.rejects(
        commitFileChanges(context, [{ path: 'src/content/blog/a.md', content: markdown('A') }], 'batch'),
        (error: unknown) => {
          assert.ok(error instanceof GithubCmsError);
          assert.equal(error.status, 502);
          assert.match(error.message, testCase.message);
          return true;
        },
      );
      assert.equal(refPatches(calls).length, 0, 'a failed step must not move the branch');
    }
  });
});
