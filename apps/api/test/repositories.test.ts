import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, migrate } from '../src/database.js';
import { syncRepositories } from '../src/repository-sync.js';
import { Store } from '../src/store.js';
import type { Repo } from '../src/github.js';

test('repository sync isolates accounts, keeps stable IDs and memory, and revokes only the syncing user', async () => {
  const db = await database();
  try {
    await migrate(db);
    const a = randomUUID(),
      b = randomUUID();
    await db.query('INSERT INTO users(id,name) VALUES($1,$2),($3,$4)', [a, 'First', b, 'Second']);
    const repo = (id: number, owner: string): Repo => ({
      id,
      name: 'project-' + id,
      full_name: owner + '/project-' + id,
      description: null,
      language: 'TypeScript',
      default_branch: 'main',
      owner: { login: owner },
    });
    const store = new Store(db);
    await syncRepositories(db, a, 1, [repo(10, 'first'), repo(11, 'first')]);
    await syncRepositories(db, b, 2, [repo(20, 'second')]);
    assert.equal((await store.projects(a)).length, 2);
    assert.deepEqual(
      (await store.projects(b)).map((p) => p.owner),
      ['second'],
    );
    const first = (await store.projects(a))[0]!;
    await db.query(
      "UPDATE projects SET data=jsonb_set(data,'{memory,objective}','\"Keep project context\"') WHERE id=$1",
      [first.id],
    );
    await syncRepositories(db, a, 1, [repo(10, 'first')]);
    const updated = (await store.projects(a))[0]!;
    assert.equal(updated.id, first.id);
    assert.equal(updated.memory.objective, 'Keep project context');
    assert.equal((await store.projects(a)).length, 1);
    assert.equal((await store.projects(b)).length, 1);
    // Authorized organization members can share the same linked project without duplicates.
    await syncRepositories(db, b, 1, [repo(10, 'first')]);
    assert.equal((await store.projects(b)).find((p) => p.owner === 'first')?.id, first.id);
    await syncRepositories(db, a, 1, []);
    assert.equal((await store.projects(a)).length, 0);
    assert.equal((await store.projects(b)).length, 2);
  } finally {
    await db.close();
  }
});
