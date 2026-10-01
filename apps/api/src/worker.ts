import { AsyncLocalStorage } from 'node:async_hooks';
import { createEdgeRouter } from './edge-router.js';
import { createServer } from './server.js';
import { postgres } from './postgres.js';
import type { SQL } from './sql.js';
import { Store } from './store.js';
import { AgentWorker } from './agent.js';
import { DaytonaProvider } from './sandbox.js';
import { GitHubApp } from './github.js';
import { SupabaseCheckpoints } from './artifacts.js';
import { ModelRouter } from './models.js';

interface Bindings {
  HYPERDRIVE: { connectionString: string };
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
  RATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
  [key: string]: unknown;
}
const context = new AsyncLocalStorage<SQL>();
const current = () => {
  const db = context.getStore();
  if (!db) throw new Error('Database access requires an invocation context');
  return db;
};
const database: SQL = {
  query: (sql, values) => current().query(sql, values),
  transaction: (fn) => current().transaction(fn),
  close: async () => {},
};
// Routes and JWT metadata may be cached. Sockets belong to each invocation.
let server: ReturnType<typeof createServer> | undefined;
function configure(env: Bindings) {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') process.env[key] = value;
  }
  process.env.POCKET_MODE = 'production';
  process.env.POCKET_AGENT_PROFILE = 'free';
}
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    configure(env);
    const url = new URL(request.url);
    if (url.pathname === '/github/installed')
      return new Response(null, {
        status: 302,
        headers: {
          Location: 'pocket://github-connected?success=true&installed=true',
          'Cache-Control': 'no-store',
        },
      });
    if (url.pathname === '/auth/config')
      return json({
        demo: false,
        supabaseURL: env.SUPABASE_URL,
        publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
      });
    if (
      !url.pathname.startsWith('/v1/') &&
      !url.pathname.startsWith('/github/') &&
      url.pathname !== '/health'
    ) {
      const asset = await env.ASSETS.fetch(request);
      const headers = new Headers(asset.headers);
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set(
        'Content-Security-Policy',
        `default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ${new URL(env.SUPABASE_URL).origin}; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
      );
      return new Response(asset.body, { status: asset.status, headers });
    }
    if (
      url.pathname.startsWith('/v1/') &&
      !request.headers.get('Authorization')?.startsWith('Bearer ')
    )
      return json({ error: 'Sign in to Pocket' }, 401);
    if (
      !(await env.RATE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'unknown' }))
        .success
    )
      return json({ error: 'Too many requests. Please try again shortly.' }, 429);
    if (Number(request.headers.get('Content-Length') ?? 0) > 1024 * 1024)
      return json({ error: 'Request too large' }, 413);
    const chunks: Uint8Array[] = [];
    let length = 0;
    const reader = request.body?.getReader();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1024 * 1024) {
        await reader.cancel();
        return json({ error: 'Request too large' }, 413);
      }
      chunks.push(value);
    }
    const payload = Buffer.concat(chunks);

    const db = postgres(env.HYPERDRIVE.connectionString, { useCA: false });
    try {
      return await context.run(db, async () => {
        server ??= createServer(database, {
          demo: false,
          logger: true,
          migrateSchema: false,
          nativeRateLimit: true,
          transport: createEdgeRouter as never,
        });
        const { app } = await server;
        const response = await app.inject({
          method: request.method as 'GET' | 'POST' | 'DELETE',
          url: url.pathname + url.search,
          headers: Object.fromEntries(request.headers),
          remoteAddress: request.headers.get('CF-Connecting-IP') ?? '127.0.0.1',
          ...(payload.byteLength ? { payload: Buffer.from(payload) } : {}),
        });
        const headers = new Headers();
        for (const [key, value] of Object.entries(response.headers)) {
          if (value !== undefined && !['connection', 'transfer-encoding'].includes(key))
            headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
        }
        headers.set('Cache-Control', 'no-store');
        return new Response(
          request.method === 'HEAD' ? null : new Uint8Array(response.rawPayload),
          {
            status: response.statusCode,
            headers,
          },
        );
      });
    } catch (error) {
      server = undefined;
      console.error(
        JSON.stringify({
          event: 'api.unavailable',
          path: url.pathname,
          errorName: error instanceof Error ? error.name : 'Error',
          reason: error instanceof Error ? error.message : 'Unknown',
          stack: error instanceof Error ? error.stack : undefined,
        }),
      );
      return json({ error: 'Pocket is temporarily unavailable. Please try again.' }, 503);
    } finally {
      await db.close();
    }
  },
  async scheduled(_controller: unknown, env: Bindings): Promise<void> {
    configure(env);
    // Retry storage cleanup after an interrupted checkpoint deletion. Only tombstones are inspected.
    const cleanupHeaders = {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    };
    const cleanup = await fetch(
      `${env.SUPABASE_URL}/rest/v1/saves?data->>deleted=eq.true&or=(data->>artifactDeleted.is.null,data->>artifactDeleted.eq.false)&select=id,data&limit=5`,
      { headers: cleanupHeaders, signal: AbortSignal.timeout(15000) },
    );
    if (!cleanup.ok) throw new Error('Checkpoint cleanup inspection failed');
    for (const row of (await cleanup.json()) as {
      id: string;
      data: Record<string, unknown> & { snapshotRef: string };
    }[]) {
      await new SupabaseCheckpoints().remove(row.data.snapshotRef);
      const marked = await fetch(`${env.SUPABASE_URL}/rest/v1/saves?id=eq.${row.id}`, {
        method: 'PATCH',
        headers: { ...cleanupHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { ...row.data, artifactDeleted: true } }),
        signal: AbortSignal.timeout(15000),
      });
      if (!marked.ok) throw new Error('Checkpoint cleanup acknowledgement failed');
    }
    // Empty queues never allocate a SQL socket or sandbox. No per-user polling.
    const queued = await fetch(
      `${env.SUPABASE_URL}/rest/v1/jobs?or=(status.eq.queued,and(status.in.(analyzing,planning,editing,testing),lease_until.lt.${encodeURIComponent(new Date().toISOString())}))&select=id&limit=1`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!queued.ok) throw new Error(`Queue inspection failed: ${queued.status}`);
    const jobs = (await queued.json()) as { id: string }[];
    if (!jobs.length) return;
    const db = postgres(env.HYPERDRIVE.connectionString, { useCA: false });
    try {
      const worker = new AgentWorker(new Store(db), false, {
        sandbox: new DaytonaProvider(),
        git: new GitHubApp(),
        repository: new GitHubApp(),
        storage: new SupabaseCheckpoints(),
        router: new ModelRouter(),
      });
      await Promise.all(jobs.map(() => worker.runOne(AbortSignal.timeout(4 * 60 * 1000))));
    } finally {
      await db.close();
    }
  },
};
