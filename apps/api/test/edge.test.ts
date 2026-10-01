import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from '../src/server.js';
import { createEdgeRouter } from '../src/edge-router.js';
import { database } from '../src/database.js';
import { demoProject, demoToken } from '../src/fixtures.js';
import { GitHubApp } from '../src/github.js';

test('edge transport enforces authentication, validation, idempotency and cancellation', async () => {
  const db = await database();
  const { app } = await createServer(db, {
    nativeRateLimit: true,
    transport: createEdgeRouter as never,
  });
  const headers = {
    authorization: `Bearer ${demoToken}`,
    'content-type': 'application/json',
    'idempotency-key': randomUUID(),
  };
  try {
    assert.equal((await app.inject({ method: 'GET', url: '/v1/projects' })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
    const post = (body: string) =>
      app.inject({ method: 'POST', url: '/v1/jobs', headers, payload: Buffer.from(body) });
    assert.equal((await post('{')).statusCode, 400);
    assert.equal((await post(JSON.stringify({ prompt: 'x' }))).statusCode, 400);
    const body = JSON.stringify({
      projectId: demoProject,
      branch: 'main',
      prompt: 'Make the dashboard responsive',
      modelId: 'auto',
      maxCostCents: 300,
    });
    const created = await post(body);
    assert.equal(created.statusCode, 202);
    const job = created.json();
    assert.equal((await post(body)).json().id, job.id);
    assert.equal(
      (await app.inject({ method: 'GET', url: `/v1/jobs/${job.id}/events?after=0`, headers }))
        .statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ method: 'POST', url: `/v1/jobs/${job.id}/cancel`, headers })).statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ method: 'DELETE', url: `/v1/jobs/${job.id}`, headers })).statusCode,
      200,
    );
    assert.ok(
      !(await app.inject({ method: 'GET', url: '/v1/jobs', headers }))
        .json()
        .some((item: any) => item.id === job.id),
    );
    assert.equal(
      (await app.inject({ method: 'POST', url: '/v1/jobs', headers, payload: Buffer.alloc(20001) }))
        .statusCode,
      413,
    );
  } finally {
    await db.close();
  }
});

test('installation discovery paginates and rejects other apps and suspended installations', async () => {
  const original = globalThis.fetch;
  const originalId = process.env.GITHUB_APP_ID;
  process.env.GITHUB_APP_ID = '42';
  const pages: number[] = [];
  globalThis.fetch = async (input) => {
    const page = Number(new URL(String(input)).searchParams.get('page'));
    pages.push(page);
    const installations =
      page === 1
        ? Array.from({ length: 100 }, (_, id) => ({ id, app_id: 9, account: { login: 'other' } }))
        : [
            { id: 100, app_id: 42, account: { login: 'developer' }, suspended_at: null },
            { id: 101, app_id: 42, account: { login: 'suspended' }, suspended_at: 'today' },
          ];
    return Response.json({ installations });
  };
  try {
    const github = new GitHubApp();
    assert.deepEqual(await github.installationsForUser('test-token'), [
      { id: 100, account: 'developer' },
    ]);
    assert.deepEqual(pages, [1, 2]);
    await assert.rejects(() => github.verifyInstallation('test-token', 101), /not authorized/);
  } finally {
    globalThis.fetch = original;
    if (originalId === undefined) delete process.env.GITHUB_APP_ID;
    else process.env.GITHUB_APP_ID = originalId;
  }
});

test('personal installation access requires the verified GitHub account and excludes organizations or suspension', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const original = globalThis.fetch;
  const priorId = process.env.GITHUB_APP_ID;
  const priorKey = process.env.GITHUB_APP_PRIVATE_KEY;
  process.env.GITHUB_APP_ID = '42';
  process.env.GITHUB_APP_PRIVATE_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();
  const installations = [
    { id: 1, target_type: 'User', account: { id: 123, login: 'owner' }, suspended_at: null },
    { id: 2, target_type: 'User', account: { id: 999, login: 'other' }, suspended_at: null },
    { id: 3, target_type: 'Organization', account: { id: 123, login: 'org' }, suspended_at: null },
    { id: 4, target_type: 'User', account: { id: 123, login: 'owner' }, suspended_at: 'today' },
  ];
  globalThis.fetch = async (input, init) => {
    assert.equal(new Headers(init?.headers).get('User-Agent'), 'Pocket/0.1');
    const path = new URL(String(input)).pathname;
    return Response.json(
      path === '/app/installations'
        ? installations
        : installations.find((i) => path.endsWith('/' + i.id)),
    );
  };
  try {
    const github = new GitHubApp();
    assert.deepEqual(await github.installationsForAccount('123'), [{ id: 1, account: 'owner' }]);
    assert.deepEqual(await github.installationsForAccount('999'), [{ id: 2, account: 'other' }]);
    assert.equal(await github.isAccountInstallation('999', 2), true);
    assert.equal(await github.isAccountInstallation('999', 1), false);
    assert.equal(await github.isAccountInstallation('123', 1), true);
    for (const id of [2, 3, 4]) assert.equal(await github.isAccountInstallation('123', id), false);
  } finally {
    globalThis.fetch = original;
    if (priorId === undefined) delete process.env.GITHUB_APP_ID;
    else process.env.GITHUB_APP_ID = priorId;
    if (priorKey === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY;
    else process.env.GITHUB_APP_PRIVATE_KEY = priorKey;
  }
});
