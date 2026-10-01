import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { GitHubApp } from '../src/github.js';
import { database, migrate } from '../src/database.js';
import { seed } from '../src/seed.js';
import { Store } from '../src/store.js';
import { demoUser, demoProject } from '../src/fixtures.js';

test('GitHub reads cache indexes by commit, memoize files and list directories without sandbox compute', async () => {
  const db = await database();
  await migrate(db);
  await seed(db);
  const previousFetch = globalThis.fetch,
    oldKey = process.env.GITHUB_APP_PRIVATE_KEY,
    oldId = process.env.GITHUB_APP_ID;
  process.env.GITHUB_APP_PRIVATE_KEY = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey;
  process.env.GITHUB_APP_ID = '123';
  let head = 'a'.repeat(40),
    trees = 0,
    reads = 0;
  globalThis.fetch = async (input, options) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/access_tokens')) {
      assert.deepEqual(JSON.parse(String(options?.body)).repository_ids, [456]);
      return Response.json({ token: 'scoped-token' });
    }
    if (path.includes('/commits/'))
      return Response.json({ sha: head, commit: { tree: { sha: 'b'.repeat(40) } } });
    if (path.includes('/git/trees/')) {
      trees++;
      return Response.json({
        truncated: false,
        tree: [
          { type: 'blob', path: 'README.md' },
          { type: 'tree', path: '.agents/rules' },
          { type: 'blob', path: '.agents/rules/project.md' },
        ],
      });
    }
    if (path.includes('/contents/')) {
      reads++;
      assert.equal(new URL(String(input)).searchParams.get('ref'), head);
      return Response.json({
        type: 'file',
        size: 5,
        encoding: 'base64',
        content: Buffer.from('hello').toString('base64'),
      });
    }
    throw new Error('Unexpected GitHub call');
  };
  try {
    const store = new Store(db),
      github = new GitHubApp();
    const project = {
      ...(await store.project(demoUser, demoProject)),
      installationId: 123,
      repositoryId: 456,
      owner: 'owner',
      name: 'repo',
    };
    const reader = await github.open(project, 'main', db);
    assert.equal(reader.index.paths.length, 2);
    assert.equal(reader.list('.agents/rules'), '.agents/rules/project.md');
    assert.equal(JSON.parse(await reader.read('.agents/rules')).directory, true);
    assert.equal(await reader.read('README.md'), 'hello');
    assert.equal(await reader.read('README.md'), 'hello');
    assert.equal(reads, 1);
    await assert.rejects(async () => reader.read('../outside'), /Unsafe|Invalid|Path/);
    await github.open(project, 'main', db);
    assert.equal(trees, 1);
    head = 'c'.repeat(40);
    await github.open(project, 'main', db);
    assert.equal(trees, 2);
    assert.equal(Object.hasOwn((await store.projects(demoUser))[0]!, 'repositoryIndex'), false);
  } finally {
    globalThis.fetch = previousFetch;
    await db.close();
    if (oldKey === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY;
    else process.env.GITHUB_APP_PRIVATE_KEY = oldKey;
    if (oldId === undefined) delete process.env.GITHUB_APP_ID;
    else process.env.GITHUB_APP_ID = oldId;
  }
});
