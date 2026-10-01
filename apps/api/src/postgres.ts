import pg from 'pg';
import type { SQL } from './sql.js';
export function postgres(url: string, { useCA = true } = {}): SQL {
  const connection = new URL(url);
  const ca = useCA ? process.env.DATABASE_SSL_CA?.replace(/\\n/g, '\n') : undefined;
  if (ca) {
    for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey'])
      connection.searchParams.delete(key);
  }
  const pool = new pg.Pool({
    connectionString: connection.toString(),
    max: 2,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 1000,
    ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}),
  });
  const wrapper = (client: pg.Pool | pg.PoolClient): SQL => ({
    query: async (s, v) => client.query(s, v),
    transaction: async (fn) => {
      if (!(client instanceof pg.Pool)) throw new Error('Nested transactions are unsupported');
      const c = await client.connect();
      try {
        await c.query('BEGIN');
        const result = await fn(wrapper(c));
        await c.query('COMMIT');
        return result;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    },
    close: async () => {
      await pool.end();
    },
  });
  return wrapper(pool);
}
