import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, migrate } from '../src/database.js';
import { seed } from '../src/seed.js';
import { demoUser, demoProject } from '../src/fixtures.js';
import { Store } from '../src/store.js';
import { AgentWorker } from '../src/agent.js';
import { ModelRouter, type LLMProvider } from '../src/models.js';
import type { SandboxHandle } from '../src/sandbox.js';
import type { Checkpoint } from '../src/artifacts.js';
import type { GitProvider } from '../src/github.js';
async function harness(actions: unknown[], budget = 300) {
  const db = await database();
  await migrate(db);
  await seed(db);
  const store = new Store(db);
  await db.query(
    'UPDATE projects SET data=data || \'{"installationId":123,"repositoryId":456}\'::jsonb WHERE id=$1',
    [demoProject],
  );
  let deleted = 0,
    writes = 0,
    calls = 0,
    stored = 0;
  const handle: SandboxHandle = {
    id: 'test-sandbox',
    exec: async (c) => ({
      exitCode: 0,
      output: c === 'git rev-parse HEAD' ? 'a'.repeat(40) : 'ok',
    }),
    read: async () => 'const value = 1;',
    write: async () => {
      writes++;
    },
    restore: async () => {},
    destroy: async () => {
      deleted++;
    },
    checkpoint: async () => ({
      bundle: Buffer.from('git-bundle'),
      changes: [{ path: 'src/app.ts', content: Buffer.from('new code').toString('base64') }],
      commit: 'b'.repeat(40),
      baseRef: 'a'.repeat(40),
      files: [{ path: 'src/app.ts', additions: 1, deletions: 1, patch: '-old\n+new' }],
    }),
  };
  process.env.OPENAI_API_KEY = 'test-not-a-real-key';
  const router = new ModelRouter(
    JSON.stringify([
      {
        id: 'test',
        name: 'Test',
        description: 'Test provider',
        provider: 'openai',
        model: 'test',
        maxCostCents: 300,
        inputCentsPerMillion: 100,
        outputCentsPerMillion: budget === 1 ? 3000 : 200,
      },
    ]),
  );
  const llm: LLMProvider = {
    complete: async () => ({
      text: JSON.stringify(actions[calls++] ?? { kind: 'run', command: 'true' }),
      inputTokens: 100,
      outputTokens: 20,
    }),
  };
  const git: GitProvider = {
    readToken: async () => 'read-only-test-token',
    repositories: async () => [],
    branches: async () => ['main'],
    ship: async () => {
      throw new Error('Agent must never ship');
    },
  };
  const worker = new AgentWorker(store, false, {
    sandbox: { create: async () => handle },
    git,
    router,
    llm,
    storage: {
      put: async () => {
        stored++;
        return 'private/checkpoint';
      },
      get: async () => {
        throw new Error('not used');
      },
    },
  });
  const job = await store.create(
    demoUser,
    {
      projectId: demoProject,
      branch: 'main',
      prompt: 'Update one value, run tests, do not push.',
      modelId: 'test',
      maxCostCents: budget,
    },
    randomUUID(),
    false,
  );
  return { db, store, worker, job, stats: () => ({ deleted, writes, calls, stored }) };
}
test('real runtime uses bounded tools, persists usage and destroys sandbox', async () => {
  const h = await harness([
    { kind: 'read', path: 'src/app.ts' },
    { kind: 'write', path: 'src/app.ts', content: 'const value = 2;' },
    { kind: 'check', name: 'Tests', command: 'npm test' },
    { kind: 'finish', summary: 'Updated the value and ran tests.' },
  ]);
  try {
    await h.worker.runOne();
    const job = await h.store.job(demoUser, h.job.id);
    assert.equal(job.status, 'completed');
    assert.equal(job.demo, false);
    assert.equal(job.report?.checks[0]?.status, 'passed');
    assert.deepEqual(h.stats(), { deleted: 1, writes: 1, calls: 4, stored: 1 });
    assert.equal(
      (await h.db.query('SELECT count(*)::int AS n FROM usage WHERE job_id=$1', [job.id])).rows[0]
        ?.n,
      4,
    );
  } finally {
    await h.db.close();
  }
});
test('checks are invalidated by edits after verification', async () => {
  const h = await harness([
    { kind: 'check', name: 'Tests', command: 'npm test' },
    { kind: 'write', path: 'src/app.ts', content: 'new code' },
    { kind: 'finish', summary: 'Changed after testing.' },
  ]);
  try {
    await h.worker.runOne();
    assert.equal((await h.store.job(demoUser, h.job.id)).report?.checks[0]?.status, 'skipped');
  } finally {
    await h.db.close();
  }
});
test('step limit fails the task and always cleans up compute', async () => {
  const h = await harness([]);
  try {
    await h.worker.runOne();
    const job = await h.store.job(demoUser, h.job.id);
    assert.equal(job.status, 'failed');
    assert.match(job.error!, /Maximum agent steps/);
    assert.equal(h.stats().calls, 24);
    assert.equal(h.stats().deleted, 1);
    assert.equal(h.stats().stored, 0);
  } finally {
    await h.db.close();
  }
});
test('cost is reserved before making a potentially expensive model call', async () => {
  const h = await harness([{ kind: 'finish', summary: 'Done' }], 1);
  try {
    await h.worker.runOne();
    assert.equal((await h.store.job(demoUser, h.job.id)).status, 'failed');
    assert.equal(h.stats().calls, 0);
    assert.equal(h.stats().deleted, 1);
  } finally {
    await h.db.close();
  }
});
test('runtime cancellation destroys compute and does not persist a completed report', async () => {
  const h = await harness([]);
  const abort = new AbortController();
  abort.abort(new Error('Cancelled'));
  try {
    await h.worker.runOne(abort.signal);
    assert.equal((await h.store.job(demoUser, h.job.id)).status, 'failed');
    assert.equal(h.stats().calls, 0);
    assert.equal(h.stats().stored, 0);
  } finally {
    await h.db.close();
  }
});
