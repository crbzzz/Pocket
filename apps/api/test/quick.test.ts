import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quickRequest, clearIntent } from '../src/quick-requests.js';
import { quickAnswer, localizeQuickAnswer } from '../src/repository-reader.js';
import { demoUser, demoProject } from '../src/fixtures.js';
import { database, migrate } from '../src/database.js';
import { seed } from '../src/seed.js';
import { Store } from '../src/store.js';
import { AgentWorker } from '../src/agent.js';
import { ModelRouter } from '../src/models.js';
import { randomUUID } from 'node:crypto';

test('quick routing handles short bilingual questions without swallowing change requests', () => {
  for (const prompt of [
    'is there any files in this repository ?',
    'are there any files in the repo?',
    'liste les fichiers du repo',
    'est-ce qu’il y a des fichiers dans le repo?'.replace('’', "'"),
  ])
    assert.deepEqual(quickRequest(prompt), { kind: 'files' }, prompt);
  assert.deepEqual(quickRequest('how many files in this repository?'), { kind: 'count' });
  assert.deepEqual(quickRequest('read README.md'), { kind: 'read', path: 'README.md' });
  for (const prompt of [
    'list files and delete them',
    'read ../secret.txt',
    'read .git/config',
    'summarize then rewrite this repository',
  ])
    assert.equal(quickRequest(prompt), undefined);
  assert.equal(clearIntent('résume le repo'), 'analysis');
  assert.equal(clearIntent('fix the login bug'), 'change');
  assert.equal(clearIntent('summarize then rewrite the repository'), undefined);
});
test('verified file answers are short and distinguish empty and truncated indexes', async () => {
  const project = { name: 'test', owner: 'owner', description: '', language: 'TypeScript' } as any;
  const reader = {
    index: { commit: 'a', paths: ['README.md', 'src/app.ts'], truncated: false },
    read: async () => '',
    list: () => '',
    search: async () => '',
  };
  assert.match(await quickAnswer({ kind: 'files' }, reader, project, 'main'), /2 files/);
  reader.index.paths = [];
  assert.match(await quickAnswer({ kind: 'files' }, reader, project, 'main'), /no files/);
  reader.index.paths = ['a'];
  reader.index.truncated = true;
  assert.match(await quickAnswer({ kind: 'count' }, reader, project, 'main'), /At least/);
  assert.match(
    localizeQuickAnswer(
      await quickAnswer({ kind: 'files' }, reader, project, 'main'),
      'liste les fichiers',
    ),
    /fichiers/,
  );
});
test('quick file questions finish with zero model calls, zero sandbox allocation and zero checkpoints', async () => {
  const db = await database();
  await migrate(db);
  await seed(db);
  const old = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'fixture';
  try {
    await db.query(
      'UPDATE projects SET data=data || \'{"installationId":123,"repositoryId":456}\'::jsonb WHERE id=$1',
      [demoProject],
    );
    const store = new Store(db);
    const job = await store.create(
      demoUser,
      {
        projectId: demoProject,
        branch: 'main',
        prompt: 'is there any files in this repository ?',
        modelId: 'test',
        maxCostCents: 1,
      },
      randomUUID(),
      false,
    );
    const never = async () => {
      throw new Error('Expensive operation must not be called');
    };
    const router = new ModelRouter(
      JSON.stringify([
        {
          id: 'test',
          name: 'Test',
          description: 'Test',
          provider: 'openai',
          model: 'test',
          maxCostCents: 1,
          inputCentsPerMillion: 100,
          outputCentsPerMillion: 200,
        },
      ]),
    );
    const worker = new AgentWorker(store, false, {
      router,
      llm: { complete: never },
      sandbox: { create: never },
      git: { readToken: never, repositories: never, branches: never, ship: never },
      storage: { put: never, get: never },
      repository: {
        open: async () => ({
          index: { commit: 'a'.repeat(40), paths: ['README.md'], truncated: false },
          list: () => 'README.md',
          read: never,
          search: never,
        }),
      },
    });
    await worker.runOne(undefined, job.id);
    const completed = await store.job(demoUser, job.id);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.report?.costCents, 0);
    assert.equal(completed.intent, 'analysis');
    assert.equal(
      (await store.saves(demoUser, demoProject)).filter((s) => s.jobId === job.id).length,
      0,
    );
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM usage WHERE job_id=$1', [job.id])).rows[0]?.n,
      0,
    );
  } finally {
    await db.close();
    if (old === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = old;
  }
});
