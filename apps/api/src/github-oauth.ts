import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { z } from 'zod';
import type { SQL } from './database.js';
import { DomainError } from './domain.js';
function encryptionKey(): Buffer {
  const value = process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value))
    throw new DomainError(503, 'GitHub token encryption is not configured');
  return Buffer.from(value, 'hex');
}
export function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}
export function decryptToken(value: string): string {
  const data = Buffer.from(value, 'base64');
  const cipher = createDecipheriv('aes-256-gcm', encryptionKey(), data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
}
export class GitHubAuthorization {
  constructor(private db: SQL) {}
  async start(userId: string, githubId: string): Promise<string> {
    const client = process.env.GITHUB_APP_CLIENT_ID;
    const base = process.env.POCKET_PUBLIC_URL;
    if (!client || !base || new URL(base).protocol !== 'https:')
      throw new DomainError(503, 'GitHub App OAuth is not configured');
    encryptionKey();
    const state = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(state).digest('hex');
    await this.db.query('DELETE FROM github_oauth_states WHERE expires_at<now()');
    await this.db.query(
      "INSERT INTO github_oauth_states(hash,user_id,github_id,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')",
      [hash, userId, githubId],
    );
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', client);
    url.searchParams.set('redirect_uri', new URL('/github/callback', base).toString());
    url.searchParams.set('state', state);
    return url.toString();
  }
  async finish(code: string, state: string): Promise<void> {
    const hash = createHash('sha256').update(state).digest('hex');
    const row = (
      await this.db.query(
        'DELETE FROM github_oauth_states WHERE hash=$1 AND expires_at>now() RETURNING user_id,github_id',
        [hash],
      )
    ).rows[0];
    if (!row) throw new DomainError(400, 'GitHub authorization expired or was already used');
    const client = process.env.GITHUB_APP_CLIENT_ID;
    const secret = process.env.GITHUB_APP_CLIENT_SECRET;
    if (!client || !secret) throw new DomainError(503, 'GitHub App OAuth is not configured');
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: client, client_secret: secret, code }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new DomainError(502, 'GitHub authorization failed');
    const data = z
      .object({
        access_token: z.string().min(10),
        expires_in: z.number().int().positive().optional(),
      })
      .parse(await response.json());
    const identity = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${data.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Pocket/0.1',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!identity.ok) throw new DomainError(403, 'GitHub identity could not be verified');
    const user = z.object({ id: z.number().int() }).parse(await identity.json());
    if (String(user.id) !== row.github_id)
      throw new DomainError(403, 'Authorize the same GitHub account you used to sign in');
    await this.db.query(
      'INSERT INTO github_user_grants(user_id,encrypted_token,expires_at) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET encrypted_token=EXCLUDED.encrypted_token,expires_at=EXCLUDED.expires_at',
      [
        row.user_id,
        encryptToken(data.access_token),
        new Date(Date.now() + Math.min(data.expires_in ?? 28800, 28800) * 1000),
      ],
    );
  }
  async token(userId: string): Promise<string> {
    const row = (
      await this.db.query(
        'SELECT encrypted_token FROM github_user_grants WHERE user_id=$1 AND expires_at>now()',
        [userId],
      )
    ).rows[0];
    if (!row)
      throw new DomainError(
        401,
        'Authorize the Pocket GitHub App again before syncing repositories',
      );
    return decryptToken(row.encrypted_token as string);
  }
}
