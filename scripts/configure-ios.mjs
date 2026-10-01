import { loadEnvFile } from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
loadEnvFile(fileURLToPath(new URL('.env', root)));
const url = process.env.SUPABASE_URL ?? '';
const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? '';
if (new URL(url).protocol !== 'https:' || !key || /[\r\n]/.test(key)) {
  throw new Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the root .env.');
}
if (!key.startsWith('sb_publishable_')) {
  let role;
  try {
    role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role;
  } catch {}
  if (role !== 'anon')
    throw new Error(
      'The iOS app requires a public publishable/anon key, never a service-role key.',
    );
}
const apiURL = process.env.POCKET_PUBLIC_URL?.startsWith('https://') ? process.env.POCKET_PUBLIC_URL : 'http://Edouards-MacBook-Air.local:4310';
const backendMode = apiURL.startsWith('https://') ? 'production' : 'demo';
const config = new URL('apps/ios/Config/', root);
await mkdir(config, { recursive: true });
await writeFile(
  new URL('Local.xcconfig', config),
  `// Generated public client settings. Server secrets are never copied.\nPOCKET_SUPABASE_URL = ${url.replace('://', ':/$()/')}\nPOCKET_SUPABASE_PUBLISHABLE_KEY = ${key}\nPOCKET_API_URL = ${apiURL.replace('://', ':/$()/')}\nPOCKET_BACKEND_MODE = ${backendMode}\n`,
  { mode: 0o600 },
);
console.log('iOS public Supabase configuration prepared.');
