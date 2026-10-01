import { loadEnvFile } from 'node:process';
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
loadEnvFile('.env');
const names = [
  'DATABASE_URL',
  'DATABASE_SSL_CA',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DAYTONA_API_KEY',
  'DAYTONA_SNAPSHOT',
  'GITHUB_APP_ID',
  'GITHUB_APP_SLUG',
  'GITHUB_APP_CLIENT_ID',
  'GITHUB_APP_CLIENT_SECRET',
  'GITHUB_TOKEN_ENCRYPTION_KEY',
  'GITHUB_WEBHOOK_SECRET',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'MODEL_CATALOG',
  'POCKET_PUBLIC_URL',
];
const secrets = Object.fromEntries(
  names.filter((k) => process.env[k]).map((k) => [k, process.env[k]]),
);
secrets.GITHUB_APP_PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY_FILE
  ? readFileSync(process.env.GITHUB_APP_PRIVATE_KEY_FILE, 'utf8')
  : process.env.GITHUB_APP_PRIVATE_KEY;
for (const key of [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GITHUB_APP_PRIVATE_KEY',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
]) {
  if (!(secrets[key] ?? process.env[key])) throw new Error(`Missing ${key}`);
}
const config = 'infra/cloudflare/wrangler.jsonc';
function wrangler(args) {
  const result = spawnSync('npx', ['wrangler', ...args, '--config', config], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) throw new Error('Cloudflare deployment failed');
}
const directory = mkdtempSync(join(tmpdir(), 'pocket-secrets-'));
const file = join(directory, 'secrets.json');
try {
  writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
  wrangler(['secret', 'bulk', file]);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
wrangler(['deploy']);
const response = await fetch(`${process.env.POCKET_PUBLIC_URL}/health`);
if (!response.ok) throw new Error(`Deployment health check failed (${response.status})`);
console.log('Pocket API is healthy. Run npm run configure:ios before building Xcode.');
