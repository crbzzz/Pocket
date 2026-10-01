import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database, migrate } from '../src/database.js';
import { seed } from '../src/seed.js';
import { demoUser } from '../src/fixtures.js';
import { GitHubAuthorization, encryptToken, decryptToken } from '../src/github-oauth.js';
process.env.GITHUB_TOKEN_ENCRYPTION_KEY = '12'.repeat(32);
process.env.GITHUB_APP_CLIENT_ID = 'test-client';
process.env.GITHUB_APP_CLIENT_SECRET = 'test-secret';
process.env.POCKET_PUBLIC_URL = 'https://pocket.example.com';
test('GitHub user grants are encrypted and tampering is rejected', () => {
  const token = 'ghu_test_user_token_not_live';
  const value = encryptToken(token);
  assert.equal(decryptToken(value), token);
  assert.ok(!value.includes(token));
  const bytes = Buffer.from(value, 'base64');
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
  assert.throws(() => decryptToken(bytes.toString('base64')));
});
test('GitHub App authorization binds identity, consumes state once, and stores the token server-side', async () => {
  const db = await database();
  await migrate(db);
  await seed(db);
  const oauth = new GitHubAuthorization(db);
  const nativeFetch = globalThis.fetch;
  try {
    const url = new URL(await oauth.start(demoUser, '42'));
    assert.equal(url.origin, 'https://github.com');
    assert.equal(
      url.searchParams.get('redirect_uri'),
      'https://pocket.example.com/github/callback',
    );
    const state = url.searchParams.get('state')!;
    globalThis.fetch = async (input) =>
      new Response(
        JSON.stringify(
          String(input).includes('access_token')
            ? { access_token: 'ghu_test_not_live', expires_in: 3600 }
            : { id: 42 },
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    await oauth.finish('test-code', state);
    assert.equal(await oauth.token(demoUser), 'ghu_test_not_live');
    const row = (
      await db.query('SELECT encrypted_token FROM github_user_grants WHERE user_id=$1', [demoUser])
    ).rows[0]!;
    assert.notEqual(row.encrypted_token, 'ghu_test_not_live');
    await assert.rejects(() => oauth.finish('replay', state), /already used/);
    const wrong = new URL(await oauth.start(demoUser, '99')).searchParams.get('state')!;
    await assert.rejects(() => oauth.finish('test-code', wrong), /same GitHub account/);
  } finally {
    globalThis.fetch = nativeFetch;
    await db.close();
  }
});
