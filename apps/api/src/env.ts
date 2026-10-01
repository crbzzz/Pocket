import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(path)) loadEnvFile(path);

if (process.env.GITHUB_APP_PRIVATE_KEY_FILE) {
  const keyPath = resolve(
    fileURLToPath(new URL('../../../', import.meta.url)),
    process.env.GITHUB_APP_PRIVATE_KEY_FILE,
  );
  process.env.GITHUB_APP_PRIVATE_KEY = readFileSync(keyPath, 'utf8');
}
