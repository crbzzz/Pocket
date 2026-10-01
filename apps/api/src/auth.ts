import { createClient } from '@supabase/supabase-js';
import { DomainError } from './domain.js';
import { demoToken, demoUser } from './fixtures.js';
import type { SQL } from './database.js';
export function authenticator(demo: boolean, db: SQL) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const supabase =
    !demo && url && key
      ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
      : null;
  if (!demo && !supabase) throw new Error('Supabase Auth configuration is required in production');
  return async (authorization?: string): Promise<string> => {
    const token = authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new DomainError(401, 'Sign in to Pocket');
    if (demo) {
      if (token !== demoToken) throw new DomainError(401, 'Invalid demo session');
      return demoUser;
    }
    const { data, error } = await supabase!.auth.getClaims(token);
    if (error || !data?.claims.sub || data.claims.role !== 'authenticated')
      throw new DomainError(401, 'Your session has expired');
    const id = data.claims.sub;
    await db.query('INSERT INTO users(id,name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [
      id,
      'Developer',
    ]);
    return id;
  };
}
