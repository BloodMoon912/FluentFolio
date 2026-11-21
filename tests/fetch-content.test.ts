import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { DEFAULT_CONTENT_REPO, fetchContent, gitEnv, repoUrl, resolveConfig } from '../scripts/fetch-content.mjs';

const scratch: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function write(root: string, relativePath: string, text: string): void {
  const full = join(root, relativePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

/** A local "private content repository": real git history, content under src/content. */
function makeContentRepo(): string {
  const repo = tempDir('bm-content-repo-');
  write(repo, 'src/content/blog/hello.md', '---\ntitle: Hello\n---\nbody\n');
  write(repo, 'src/content/novel/ch1.md', '---\ntitle: One\n---\nbody\n');
  write(repo, 'README.md', 'not content');
  write(repo, '.github/workflows/x.yml', 'name: not content');
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
      stdio: 'ignore',
    });
  git('init', '--quiet', '-b', 'main');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'seed');
  return repo;
}

function makeProject(): string {
  return tempDir('bm-site-');
}

describe('resolveConfig', () => {
  it('is fail-closed on Workers Builds and optional elsewhere', () => {
    assert.equal(resolveConfig({ WORKERS_CI: '1' }).required, true);
    assert.equal(resolveConfig({}).required, false);
    assert.equal(resolveConfig({ CI: 'true' }).required, false);
  });

  it('lets CONTENT_REQUIRED override the environment either way', () => {
    assert.equal(resolveConfig({ WORKERS_CI: '1', CONTENT_REQUIRED: '0' }).required, false);
    assert.equal(resolveConfig({ CONTENT_REQUIRED: '1' }).required, true);
  });

  it('applies defaults and trims values', () => {
    const config = resolveConfig({ CONTENT_REPO_TOKEN: '  tok  ' });
    assert.equal(config.repo, DEFAULT_CONTENT_REPO);
    assert.equal(config.ref, 'main');
    assert.equal(config.token, 'tok');
  });
});

describe('repoUrl', () => {
  it('expands owner/name to a GitHub HTTPS URL', () => {
    assert.equal(repoUrl('owner/repo'), 'https://github.com/owner/repo.git');
  });

  it('keeps full URLs and rejects malformed slugs', () => {
    assert.equal(repoUrl('file:///tmp/x'), 'file:///tmp/x');
    assert.throws(() => repoUrl('not a repo'));
    assert.throws(() => repoUrl('../../etc'));
  });
});

describe('gitEnv', () => {
  it('passes the token through git config environment variables only', () => {
    const env = gitEnv('secret-token', { PATH: '/bin' });
    assert.equal(env.GIT_CONFIG_COUNT, '1');
    assert.equal(env.GIT_CONFIG_KEY_0, 'http.https://github.com/.extraheader');
    const expected = Buffer.from('x-access-token:secret-token').toString('base64');
    assert.equal(env.GIT_CONFIG_VALUE_0, `AUTHORIZATION: basic ${expected}`);
    assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  });

  it('adds no auth config without a token', () => {
    assert.equal(gitEnv('', {}).GIT_CONFIG_COUNT, undefined);
  });
});

describe('fetchContent', () => {
  it('clones the content repo and copies only the four collections', () => {
    const repo = makeContentRepo();
    const root = makeProject();
    const result = fetchContent({ root, env: { CONTENT_REPO: pathToFileURL(repo).href } });
    assert.equal(result.status, 'fetched');
    assert.deepEqual(result.counts, { blog: 1, novel: 1, dictionary: 0, world: 0 });
    assert.equal(readFileSync(join(root, 'src/content/blog/hello.md'), 'utf8').includes('Hello'), true);
    assert.equal(existsSync(join(root, 'src/content/dictionary')), true);
    assert.equal(existsSync(join(root, 'src/README.md')), false);
    assert.equal(existsSync(join(root, '.github')), false);
    assert.equal(existsSync(join(root, 'src/content/.git')), false);
  });

  it('leaves existing content alone', () => {
    const root = makeProject();
    write(root, 'src/content/blog/mine.md', 'local');
    const result = fetchContent({ root, env: { CONTENT_REPO: 'file:///does/not/exist' } });
    assert.equal(result.status, 'skipped');
    assert.equal(readFileSync(join(root, 'src/content/blog/mine.md'), 'utf8'), 'local');
  });

  it('fails closed when content is required but cannot be fetched', () => {
    const root = makeProject();
    assert.throws(
      () => fetchContent({ root, env: { CONTENT_REQUIRED: '1', CONTENT_REPO: 'owner/repo' } }),
      /CONTENT_REPO_TOKEN is not set/,
    );
    assert.throws(
      () => fetchContent({ root, env: { CONTENT_REQUIRED: '1', CONTENT_REPO: 'file:///does/not/exist' } }),
      /Refusing to build/,
    );
  });

  it('degrades to empty collections when content is optional', () => {
    const root = makeProject();
    const result = fetchContent({ root, env: { CONTENT_REQUIRED: '0', CONTENT_REPO: 'owner/repo' } });
    assert.equal(result.status, 'empty');
    for (const collection of ['blog', 'novel', 'dictionary', 'world']) {
      assert.equal(existsSync(join(root, 'src/content', collection)), true);
    }
  });

  it('never echoes the token when a clone fails', () => {
    const root = makeProject();
    assert.throws(
      () =>
        fetchContent({
          root,
          env: {
            CONTENT_REQUIRED: '1',
            CONTENT_REPO: 'https://github.com/owner/repo.git',
            CONTENT_REPO_TOKEN: 'SECRET-TOKEN-123',
            // Nothing listens here, so the clone fails fast without network access.
            HTTPS_PROXY: 'http://127.0.0.1:9',
            PATH: process.env.PATH,
          },
        }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.equal(message.includes('SECRET-TOKEN-123'), false);
        assert.equal(message.includes(Buffer.from('x-access-token:SECRET-TOKEN-123').toString('base64')), false);
        return true;
      },
    );
  });

  it('--from mirrors a local clone and removes entries that no longer exist there', () => {
    const repo = makeContentRepo();
    const root = makeProject();
    write(root, 'src/content/blog/stale.md', 'stale');
    const result = fetchContent({ root, env: {}, from: repo });
    assert.equal(result.status, 'synced');
    assert.equal(existsSync(join(root, 'src/content/blog/stale.md')), false);
    assert.equal(existsSync(join(root, 'src/content/blog/hello.md')), true);
  });

  it('--from applies the private overlay (identity config and brand media)', () => {
    const repo = makeContentRepo();
    write(repo, 'site.config.json', '{"title":"Private Site"}');
    write(repo, 'assets/brand/logo.svg', '<svg/>');
    write(repo, 'assets/brand/icons/icon-192.png', 'png');
    write(repo, 'assets/background.webp', 'webp');
    const root = makeProject();
    write(root, 'site.config.json', '{"title":"Theme Default"}');

    fetchContent({ root, env: {}, from: repo });

    assert.equal(readFileSync(join(root, 'site.config.json'), 'utf8'), '{"title":"Private Site"}');
    assert.equal(existsSync(join(root, 'public/brand/logo.svg')), true);
    assert.equal(existsSync(join(root, 'public/brand/icons/icon-192.png')), true);
    assert.equal(existsSync(join(root, 'src/assets/background.webp')), true);
  });

  it('--from keeps theme defaults when the content repository has no overlay', () => {
    const repo = makeContentRepo();
    const root = makeProject();
    write(root, 'site.config.json', '{"title":"Theme Default"}');

    fetchContent({ root, env: {}, from: repo });

    assert.equal(readFileSync(join(root, 'site.config.json'), 'utf8'), '{"title":"Theme Default"}');
  });
  it('--from rejects a path that is not a content repository', () => {
    const root = makeProject();
    assert.throws(() => fetchContent({ root, env: {}, from: tempDir('bm-empty-') }), /does not exist/);
  });
});
