import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, migrate } from '../src/database.js';
import { seed } from '../src/seed.js';
import { Store } from '../src/store.js';
import { demoUser, demoProject } from '../src/fixtures.js';
const demoJob='00000000-0000-4000-8000-000000000020';
import { Previews, previewPlan } from '../src/previews.js';
test('preview detects actual web frameworks and rejects native-only projects', () => {
  assert.match(
    previewPlan(['package.json'], JSON.stringify({ scripts: { dev: 'next dev' } })).command,
    /--hostname 0.0.0.0/,
  );
  assert.match(
    previewPlan(['package.json', 'pnpm-lock.yaml'], JSON.stringify({ scripts: { dev: 'vite' } }))
      .install!,
    /pnpm install/,
  );
  assert.match(previewPlan(['index.html']).command, /http.server/);
  assert.throws(
    () => previewPlan(['package.json'], JSON.stringify({ scripts: { start: 'expo start' } })),
    /No supported/,
  );
});
test('preview restores the selected checkpoint, owner-scopes access, fences duplicate starts and destroys compute on close', async () => {
  const db = await database();
  await migrate(db);
  await seed(db);
  const store = new Store(db);
  let creates = 0,
    destroys = 0,
    restored = '';
  const handle = {
    id: 'sandbox',
    exec: async (command: string) => ({
      exitCode: 0,
      output: command.startsWith('git ls-files') ? 'index.html\n' : '',
    }),
    read: async () => '',
    write: async () => {},
    restore: async (_bundle: Buffer, commit: string) => {
      restored = commit;
    },
    checkpoint: async () => {
      throw Error('Not needed');
    },
    preview: async () => 'https://preview.example.test',
    previewLogs: async () => 'started',
    destroy: async () => {
      destroys++;
    },
  };
  const sandboxes = {
    create: async () => {
      creates++;
      return handle;
    },
    attach: async () => handle,
  };
  const storage = {
    get: async () => ({
      commit: 'saved-commit',
      baseRef: 'base',
      bundle: Buffer.from('fixture'),
      changes: [],
    }),
    put: async () => '',
  };
  const preview = new Previews(
    db,
    store,
    sandboxes,
    { readToken: async () => 'read' } as any,
    storage,
  );
  try {
    const p = await preview.create(demoUser, demoJob);
    await assert.rejects(() => preview.get(randomUUID(), p.id), /not found/);
    const result = await preview.start(demoUser, p.id);
    assert.equal(result.status, 'ready');
    assert.equal(result.url, 'https://preview.example.test');
    assert.equal(restored, 'saved-commit');
    assert.equal(creates, 1);
    assert.equal((result as any).sandboxId, undefined);
    await preview.start(demoUser, p.id);
    assert.equal(creates, 1);
    await preview.stop(demoUser, p.id);
    assert.equal(destroys, 1);
    assert.equal((await preview.get(demoUser, p.id)).status, 'closed');
    const p2 = await preview.create(demoUser, demoJob);
    assert.notEqual(p2.id, p.id);
    await db.query(
      "UPDATE previews SET expires_at=now()-interval '1 minute',data=jsonb_set(data,'{expiresAt}',to_jsonb((now()-interval '1 minute')::text)) WHERE id=$1",
      [p2.id],
    );
    assert.equal((await preview.get(demoUser, p2.id)).status, 'closed');
  } finally {
    await db.close();
  }
});
test('correction requests cannot restore a different user checkpoint or branch', async () => {
  const db = await database();
  await migrate(db);
  await seed(db);
  const store = new Store(db);
  try {
    const job = await store.create(
      demoUser,
      {
        projectId: demoProject,
        branch: 'main',
        prompt: 'Fix saved changes',
        modelId: 'auto',
        maxCostCents: 10,
        baseJobId: demoJob,
      },
      randomUUID(),
      true,
    );
    assert.equal(job.baseJobId, demoJob);
    await assert.rejects(
      () =>
        store.create(
          demoUser,
          {
            projectId: demoProject,
            branch: 'main',
            prompt: 'Fix saved changes',
            modelId: 'auto',
            maxCostCents: 10,
            baseJobId: randomUUID(),
          },
          randomUUID(),
          true,
        ),
      /not found/,
    );
  } finally {
    await db.close();
  }
});
