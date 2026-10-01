import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { database, type SQL } from '../src/database.js';
import { createServer } from '../src/server.js';
import { demoProject, demoToken, demoUser, demoReport } from '../src/fixtures.js';
import { AgentWorker } from '../src/agent.js';
import { safePath, quote } from '../src/sandbox.js';
import { parseAction } from '../src/models.js';
import { Store } from '../src/store.js';
let db: SQL;
let server: Awaited<ReturnType<typeof createServer>>;
const headers = { authorization: `Bearer ${demoToken}` };
const payload = {
  projectId: demoProject,
  branch: 'main',
  prompt: 'Make the dashboard responsive',
  modelId: 'auto',
  maxCostCents: 300,
};
before(async () => {
  db = await database();
  server = await createServer(db);
});
after(async () => {
  await server?.app.close();
  await db?.close();
});
test('authentication is required, including events and checkpoints', async () => {
  for (const url of ['/v1/projects', '/v1/jobs', '/v1/projects/' + demoProject + '/saves'])
    assert.equal((await server.app.inject({ url })).statusCode, 401);
  assert.equal((await server.app.inject({ url: '/health' })).statusCode, 200);
});
test('validates request shape and excludes unauthorized branches', async () => {
  for (const body of [
    { ...payload, prompt: 'x' },
    { ...payload, branch: '../../main' },
    { ...payload, autoPush: true },
    { ...payload, branch: 'unknown' },
    { ...payload, maxCostCents: 0 },
  ]) {
    assert.equal(
      (
        await server.app.inject({
          method: 'POST',
          url: '/v1/jobs',
          headers: { ...headers, 'idempotency-key': randomUUID() },
          payload: body,
        })
      ).statusCode,
      400,
    );
  }
});
test('submission is idempotent, conflicts reject, slots are bounded, cancellation releases a slot', async () => {
  const key = randomUUID();
  const post = (body = payload, k = key) =>
    server.app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { ...headers, 'idempotency-key': k },
      payload: body,
    });
  const first = await post();
  assert.equal(first.statusCode, 202, first.body);
  const id = first.json().id;
  assert.equal((await post()).json().id, id);
  assert.equal((await post({ ...payload, prompt: 'Another task' })).statusCode, 409);
  const second = await post(payload, randomUUID());
  assert.equal(second.statusCode, 202);
  assert.equal((await post(payload, randomUUID())).statusCode, 429);
  assert.equal(
    (await server.app.inject({ method: 'POST', url: `/v1/jobs/${id}/cancel`, headers })).json()
      .status,
    'cancelled',
  );
  await server.store.cancel(demoUser, second.json().id);
});
test('tenant boundaries hide projects, jobs and saves', async () => {
  const user = randomUUID();
  await db.query("INSERT INTO users(id,name) VALUES($1,'Other user')", [user]);
  const other = new Store(db);
  assert.deepEqual(await other.projects(user), []);
  await assert.rejects(() => other.project(user, demoProject), /Project not found/);
  await assert.rejects(
    () => other.job(user, '00000000-0000-4000-8000-000000000020'),
    /Agent not found/,
  );
  await assert.rejects(() => other.saves(user, demoProject), /Project not found/);
});
test('queue leases cannot be stolen and cancellation fences completion', async () => {
  const j = await server.store.create(demoUser, payload, randomUUID(), true);
  const lease = await server.store.claim();
  assert.equal(lease?.job.id, j.id);
  assert.equal(await server.store.heartbeat(j.id, randomUUID()), false);
  assert.equal(await server.store.transition(j.id, randomUUID(), 'planning', 'Bad worker'), false);
  await server.store.cancel(demoUser, j.id);
  assert.equal(
    await server.store.transition(j.id, lease!.token, 'completed', 'done', demoReport),
    false,
  );
  assert.equal((await server.store.job(demoUser, j.id)).status, 'cancelled');
});
test('expired worker lease fails closed instead of replaying work', async () => {
  const j = await server.store.create(demoUser, payload, randomUUID(), true);
  await server.store.claim();
  await db.query("UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [j.id]);
  await server.store.claim();
  assert.equal((await server.store.job(demoUser, j.id)).status, 'failed');
});
test('completed task atomically creates a Save, memory and ordered resumable events', async () => {
  const before = (await server.store.saves(demoUser, demoProject)).length;
  const j = await server.store.create(demoUser, payload, randomUUID(), true);
  assert.equal(await new AgentWorker(server.store, true).runOne(), true);
  const result = await server.store.job(demoUser, j.id);
  assert.equal(result.status, 'completed');
  assert.equal(result.report?.files.length, 4);
  assert.equal((await server.store.saves(demoUser, demoProject)).length, before + 1);
  assert.match(
    (await server.store.project(demoUser, demoProject)).memory.recentWork[0]!,
    /Demo run completed/,
  );
  const events = await server.store.events(demoUser, j.id, 0);
  assert.deepEqual(
    events.map((e) => e.phase),
    ['queued', 'analyzing', 'planning', 'editing', 'testing', 'completed'],
  );
  const after = await server.store.events(demoUser, j.id, events[2]!.sequence);
  assert.equal(after.length, 3);
  const save = (await server.store.saves(demoUser, demoProject))[0]!;
  await server.store.restore(demoUser, demoProject, save.id);
  const p = (await server.store.project(demoUser, demoProject)) as any;
  assert.equal(p.branchSaves.main, save.snapshotRef);
});
test('shipping requires approval and supports safe replay', async () => {
  const url = '/v1/jobs/00000000-0000-4000-8000-000000000020/ship';
  const h = { ...headers, 'idempotency-key': randomUUID() };
  assert.equal(
    (
      await server.app.inject({
        method: 'POST',
        url,
        headers: h,
        payload: { kind: 'pr', title: 'Mobile fix' },
      })
    ).statusCode,
    400,
  );
  const body = { kind: 'pr', title: 'Mobile fix', approved: true };
  const r = await server.app.inject({ method: 'POST', url, headers: h, payload: body });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().demo, true);
  assert.match(r.json().branch, /^pocket\//);
  assert.deepEqual(
    (await server.app.inject({ method: 'POST', url, headers: h, payload: body })).json(),
    r.json(),
  );
  assert.equal(
    (
      await server.app.inject({
        method: 'POST',
        url,
        headers: h,
        payload: { ...body, title: 'Different change' },
      })
    ).statusCode,
    409,
  );
});
test('polling avoids diff bodies but detail retains the review', async () => {
  const list = await server.store.jobs(demoUser);
  const demo = list.find((j) => j.id === '00000000-0000-4000-8000-000000000020');
  assert.equal(demo?.report?.files[0]?.patch, '');
  assert.match((await server.store.job(demoUser, demo!.id)).report!.files[0]!.patch, /Sidebar/);
});
test('filesystem paths and model actions are validated', () => {
  for (const p of [
    '/etc/passwd',
    '../secret',
    'src/../../secret',
    '.git/config',
    'src/.git/config',
    'hello\0',
  ])
    assert.throws(() => safePath(p));
  assert.equal(safePath('src/sidebar.tsx'), 'src/sidebar.tsx');
  assert.equal(quote("it's a file"), "'it'\\''s a file'");
  assert.deepEqual(parseAction('```json\n{"kind":"read","path":"src/app.ts"}\n```'), {
    kind: 'read',
    path: 'src/app.ts',
  });
  assert.throws(() => parseAction('{"kind":"push"}'));
});

test('signed webhook revokes access, cancels work and rejects malformed signatures', async () => {
  process.env.GITHUB_WEBHOOK_SECRET = 'test-webhook-secret';
  await db.query('UPDATE projects SET data=data || \'{"installationId":123}\'::jsonb WHERE id=$1', [
    demoProject,
  ]);
  const job = await server.store.create(demoUser, payload, randomUUID(), true);
  const body = { action: 'deleted', installation: { id: 123 } };
  const signature =
    'sha256=' +
    createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET)
      .update(JSON.stringify(body))
      .digest('hex');
  const h = {
    'x-github-event': 'installation',
    'x-github-delivery': randomUUID(),
    'x-hub-signature-256': signature,
  };
  assert.equal(
    (
      await server.app.inject({
        method: 'POST',
        url: '/github/webhook',
        headers: { ...h, 'x-hub-signature-256': 'é'.repeat(71) },
        payload: body,
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (await server.app.inject({ method: 'POST', url: '/github/webhook', headers: h, payload: body }))
      .statusCode,
    204,
  );
  await assert.rejects(() => server.store.project(demoUser, demoProject), /not found/);
  assert.equal(
    (await db.query('SELECT status FROM jobs WHERE id=$1', [job.id])).rows[0]?.status,
    'cancelled',
  );
  assert.equal(
    (await server.app.inject({ method: 'POST', url: '/github/webhook', headers: h, payload: body }))
      .statusCode,
    204,
  );
});
