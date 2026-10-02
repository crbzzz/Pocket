import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, migrate } from '../src/database.js';
import { seed } from '../src/seed.js';
import { demoUser } from '../src/fixtures.js';
import { Attachments } from '../src/attachments.js';
test('images remain private, owner checked before signing, validated and storage quota enforced', async () => {
  const db = await database();
  await migrate(db);
  await seed(db);
  const oldURL = process.env.SUPABASE_URL,
    oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
    oldFetch = globalThis.fetch;
  process.env.SUPABASE_URL = 'https://fixture.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture';
  let uploads = 0,
    signs = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/sign/')) {
      signs++;
      return Response.json({ signedURL: '/object/sign/image?token=fixture' });
    }
    uploads++;
    return Response.json({ Key: 'image', Id: randomUUID() });
  };
  try {
    const images = new Attachments(db);
    await assert.rejects(
      () => images.upload(demoUser, 'image/jpeg', Buffer.from('not-an-image').toString('base64')),
      /Choose a JPEG/,
    );
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB8sAAAAASUVORK5CYII=';
    const file = await images.upload(demoUser, 'image/png', png);
    assert.equal(uploads, 1);
    await assert.rejects(() => images.url(randomUUID(), file.id), /unavailable/);
    assert.equal(signs, 0);
    assert.match((await images.url(demoUser, file.id)).url, /token=fixture/);
    assert.equal(signs, 1);
    await db.query('UPDATE attachments SET size=20000000 WHERE id=$1', [file.id]);
    await assert.rejects(() => images.upload(demoUser, 'image/png', png), /storage limit/);
    assert.equal(uploads, 1);
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, old] of [
      ['SUPABASE_URL', oldURL],
      ['SUPABASE_SERVICE_ROLE_KEY', oldKey],
    ]) {
      if (old === undefined) delete process.env[key!];
      else process.env[key!] = old;
    }
    await db.close();
  }
});
