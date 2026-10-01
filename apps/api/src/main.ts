import { database } from './database.js';
import { createServer } from './server.js';
import { AgentWorker } from './agent.js';
import { DaytonaProvider } from './sandbox.js';
import { GitHubApp } from './github.js';
import { SupabaseCheckpoints } from './artifacts.js';
import { ModelRouter } from './models.js';
import { timingSafeEqual } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const mode = process.env.POCKET_MODE ?? 'demo';
if (!['demo', 'production'].includes(mode))
  throw new Error('POCKET_MODE must be demo or production');
const demo = mode === 'demo';
if (!demo && !process.env.DATABASE_URL)
  throw new Error('Production requires Supabase PostgreSQL DATABASE_URL');
if (!demo && !process.env.DAYTONA_API_KEY)
  throw new Error('Production requires Daytona credentials');
const db = await database(
  demo ? undefined : process.env.DATABASE_URL,
  demo ? '.data/pocket' : undefined,
);
const { app, store } = await createServer(db, { demo, logger: true });
const controller = new AbortController();
const worker = new AgentWorker(
  store,
  demo,
  demo
    ? undefined
    : {
        sandbox: new DaytonaProvider(),
        git: new GitHubApp(),
        storage: new SupabaseCheckpoints(),
        router: new ModelRouter(),
      },
);
app.post(
  '/internal/drain',
  { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } },
  async (req, reply) => {
    const secret = process.env.WORKER_DISPATCH_SECRET;
    const supplied = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
    if (
      !secret ||
      Buffer.byteLength(supplied) !== Buffer.byteLength(secret) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))
    )
      return reply.code(401).send({ error: 'Unauthorized' });
    const done = await worker.runOne(controller.signal);
    return { worked: done };
  },
);
let loop: Promise<void>;
if (demo && process.env.POCKET_WORKER !== 'off')
  loop = (async () => {
    while (!controller.signal.aborted) {
      try {
        const worked = await worker.runOne(controller.signal);
        if (!worked) await delay(1000, undefined, { signal: controller.signal });
      } catch (e) {
        if (!controller.signal.aborted) app.log.error({ err: e }, 'worker failed');
        await delay(2000, undefined, { signal: controller.signal }).catch(() => {});
      }
    }
  })();
else loop = Promise.resolve();
const shutdown = async () => {
  controller.abort();
  await loop;
  await app.close();
  await db.close();
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
await app.listen({
  port: Number(process.env.PORT ?? 4310),
  host: demo ? '127.0.0.1' : (process.env.HOST ?? '0.0.0.0'),
});
