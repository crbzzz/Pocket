import { PGlite } from '@electric-sql/pglite';
import { postgres } from './postgres.js';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SQL } from './sql.js';
export { migrate } from './sql.js';
export type { SQL } from './sql.js';
export async function database(url?: string, path?: string): Promise<SQL> {
  if (url) return postgres(url);
  if (path) await mkdir(dirname(path), { recursive: true });
  const db = new PGlite(path);
  const wrap = (client: Pick<PGlite, 'query'>): SQL => ({
    query: async (s, v) => client.query(s, v),
    transaction: async (fn) => db.transaction((tx) => fn(wrap(tx))),
    close: () => db.close(),
  });
  return wrap(db);
}
