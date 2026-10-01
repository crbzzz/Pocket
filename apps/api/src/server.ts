import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z, ZodError } from 'zod';
import { type SQL, migrate } from './sql.js';
import { authenticator } from './auth.js';
import { Store } from './store.js';
import { syncRepositories } from './repository-sync.js';
import { DomainError, taskInput } from './domain.js';
import { models } from './fixtures.js';
import { seed } from './seed.js';
import { ModelRouter } from './models.js';
import { GitHubApp } from './github.js';
import { SupabaseCheckpoints } from './artifacts.js';
import { limits } from './agent.js';
import { GitHubAuthorization } from './github-oauth.js';
export async function createServer(
  db: SQL,
  {
    demo = true,
    logger = false,
    migrateSchema = true,
    nativeRateLimit = false,
    transport = Fastify,
  }: {
    demo?: boolean;
    logger?: boolean;
    migrateSchema?: boolean;
    nativeRateLimit?: boolean;
    transport?: typeof Fastify;
  } = {},
) {
  if (migrateSchema) await migrate(db);
  if (demo) await seed(db);
  if (!demo) {
    const tables = [
      'users',
      'projects',
      'memberships',
      'jobs',
      'events',
      'saves',
      'actions',
      'audit',
      'usage',
      'webhook_deliveries',
      'github_oauth_states',
      'github_user_grants',
    ];
    const secured = (
      await db.query(
        "SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relrowsecurity AND relname=ANY($1::text[])",
        [tables],
      )
    ).rows;
    if (secured.length !== tables.length)
      throw new Error('Apply Supabase security migration before starting production');
  }
  const app = transport({
    logger: logger
      ? { redact: ['req.headers.authorization', 'req.headers.cookie', 'body.githubToken'] }
      : false,
    bodyLimit: 20000,
    requestTimeout: 30000,
  });
  // Routes validate input with Zod; JSON serialization needs no runtime code generation.
  app.setSerializerCompiler(() => JSON.stringify);
  app.setValidatorCompiler(() => () => true);
  if (!nativeRateLimit) app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  const store = new Store(db);
  const authenticate = authenticator(demo, db);
  const router = new ModelRouter(demo ? '[]' : undefined);
  const githubIdentity = async (authorization: string | undefined): Promise<string> => {
    const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: authorization!, apikey: process.env.SUPABASE_PUBLISHABLE_KEY! },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new DomainError(401, 'Sign in again');
    const user = (await response.json()) as any;
    const identity = user.identities?.find((i: any) => i.provider === 'github');
    const id = identity?.identity_data?.provider_id ?? identity?.identity_data?.sub;
    if (!id) throw new DomainError(403, 'Sign in with GitHub first');
    return String(id);
  };
  const repositoryAccess = async (
    req: { userId: string; headers: { authorization?: string } },
    project: { installationId: number; owner: string; name: string },
  ) => {
    const github = new GitHubApp();
    if (
      await github.isAccountInstallation(
        await githubIdentity(req.headers.authorization),
        project.installationId,
      )
    )
      return;
    await github.assertUserAccess(
      await new GitHubAuthorization(db).token(req.userId),
      `${project.owner}/${project.name}`,
    );
  };
  app.decorateRequest('userId', '');
  app.decorateRequest('rawBody', null);
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    req.rawBody = body as Buffer;
    try {
      done(null, JSON.parse((body as Buffer).toString('utf8')));
    } catch {
      done(new DomainError(400, 'Invalid JSON'));
    }
  });
  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/v1/')) req.userId = await authenticate(req.headers.authorization);
  });
  app.setErrorHandler((e, _req, reply) => {
    const status =
      e instanceof ZodError
        ? 400
        : e instanceof DomainError
          ? e.statusCode
          : e instanceof Error && 'statusCode' in e && typeof e.statusCode === 'number'
            ? e.statusCode
            : 500;
    if (status >= 500) app.log.error({ err: e }, 'request failed');
    reply.code(status).send({
      error:
        status >= 500
          ? 'Service unavailable. Please try again.'
          : e instanceof Error
            ? e.message
            : 'Invalid request',
    });
  });
  app.get('/auth/config', async () => ({
    demo,
    ...(!demo
      ? {
          supabaseURL: process.env.SUPABASE_URL,
          publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
        }
      : {}),
  }));
  app.get('/health', async () => ({
    status: 'ok',
    service: 'Pocket API',
    mode: demo ? 'demo' : 'production',
  }));
  app.get('/v1/config', async () => ({
    demo,
    githubAppUrl: process.env.GITHUB_APP_SLUG
      ? `https://github.com/apps/${process.env.GITHUB_APP_SLUG}/installations/new`
      : null,
    limits: {
      maxSteps: limits.steps,
      maxRuntimeSeconds: limits.runtimeMs / 1000,
      maxTokens: limits.tokens,
      maxRetries: 1,
      maxConcurrentAgents: 2,
      maxTerminalOutput: 16000,
    },
  }));
  app.get('/v1/models', async () => (demo ? models : router.publicCatalog()));
  app.get('/v1/projects', (req) => store.projects(req.userId));
  app.get<{ Params: { id: string } }>('/v1/projects/:id', (req) =>
    store.project(req.userId, z.uuid().parse(req.params.id)),
  );
  app.get<{ Params: { id: string } }>('/v1/projects/:id/branches', async (req) => {
    const project = await store.project(req.userId, z.uuid().parse(req.params.id));
    if (demo) return project.branches;
    const linked = project as typeof project & { installationId: number; repositoryId: number };
    await repositoryAccess(req, linked);
    const branches = await new GitHubApp().branches(
      linked.installationId,
      linked.repositoryId,
      `${project.owner}/${project.name}`,
    );
    await db.query("UPDATE projects SET data=jsonb_set(data,'{branches}',$2::jsonb) WHERE id=$1", [
      project.id,
      JSON.stringify(branches),
    ]);
    return branches;
  });
  app.delete<{ Params: { id: string } }>('/v1/jobs/:id', (req) =>
    store.deleteJob(req.userId, z.uuid().parse(req.params.id)),
  );
  app.delete<{ Params: { id: string; saveId: string } }>(
    '/v1/projects/:id/saves/:saveId',
    async (req) => {
      const ref = await store.deleteSave(
        req.userId,
        z.uuid().parse(req.params.id),
        z.uuid().parse(req.params.saveId),
      );
      if (!demo) await new SupabaseCheckpoints().remove(ref);
      await db.query(
        "UPDATE saves SET data=jsonb_set(data,'{artifactDeleted}','true') WHERE id=$1",
        [req.params.saveId],
      );
      return { deleted: true };
    },
  );
  app.get('/v1/jobs', (req) => store.jobs(req.userId));
  app.post('/v1/jobs', async (req, reply) => {
    const input = taskInput.parse(req.body);
    const key = z.string().min(8).max(100).parse(req.headers['idempotency-key']);
    if (!demo) {
      router.resolve(input.modelId);
      const project = await store.project(req.userId, input.projectId);
      await repositoryAccess(req, project as typeof project & { installationId: number });
    }
    const job = await store.create(req.userId, input, key, demo);
    return reply.code(202).send(job);
  });
  app.get<{ Params: { id: string } }>('/v1/jobs/:id', (req) =>
    store.job(req.userId, z.uuid().parse(req.params.id)),
  );
  app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    '/v1/jobs/:id/events',
    (req) =>
      store.events(
        req.userId,
        z.uuid().parse(req.params.id),
        z.coerce.number().int().nonnegative().default(0).parse(req.query.after),
      ),
  );
  app.post<{ Params: { id: string } }>('/v1/jobs/:id/cancel', (req) =>
    store.cancel(req.userId, z.uuid().parse(req.params.id)),
  );
  app.get<{ Params: { id: string } }>('/v1/projects/:id/saves', (req) =>
    store.saves(req.userId, z.uuid().parse(req.params.id)),
  );
  app.post<{ Params: { id: string } }>('/v1/projects/:id/restore', async (req) => {
    const body = z
      .object({ saveId: z.uuid(), branch: z.string().max(200).optional() })
      .strict()
      .parse(req.body);
    return store.restore(req.userId, z.uuid().parse(req.params.id), body.saveId, body.branch);
  });
  app.get('/v1/usage', async (req) => {
    const rows = await store.jobs(req.userId, true);
    const usage = (
      await db.query(
        'SELECT coalesce(sum(u.cost_cents),0) AS cost FROM usage u JOIN jobs j ON u.job_id=j.id WHERE j.user_id=$1',
        [req.userId],
      )
    ).rows[0];
    return {
      tasks: rows.length,
      costCents: Math.ceil(Number(usage?.cost ?? 0)),
      active: rows.filter((j) => !['completed', 'failed', 'cancelled'].includes(j.status)).length,
    };
  });
  app.get('/v1/github/authorize', async (req) => {
    if (demo) throw new DomainError(409, 'GitHub authorization is disabled in demo mode');
    const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: req.headers.authorization!,
        apikey: process.env.SUPABASE_PUBLISHABLE_KEY!,
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new DomainError(401, 'Sign in again');
    const user = (await response.json()) as any;
    const identity = user.identities?.find((i: any) => i.provider === 'github');
    const githubId = identity?.identity_data?.provider_id ?? identity?.identity_data?.sub;
    if (!githubId) throw new DomainError(403, 'Sign in with GitHub first');
    return { url: await new GitHubAuthorization(db).start(req.userId, String(githubId)) };
  });
  app.get<{ Querystring: { code?: string; state?: string } }>(
    '/github/callback',
    async (req, reply) => {
      const input = z
        .object({ code: z.string().min(1).max(300), state: z.string().min(30).max(100) })
        .parse(req.query);
      try {
        await new GitHubAuthorization(db).finish(input.code, input.state);
        return reply.redirect('pocket://github-connected?success=true');
      } catch {
        return reply.redirect('pocket://github-connected?error=authorization_failed');
      }
    },
  );
  app.get('/v1/github/installations', async (req) => {
    if (demo) throw new DomainError(409, 'GitHub connection is disabled in demo mode');
    const github = new GitHubApp();
    const personal = await github.installationsForAccount(
      await githubIdentity(req.headers.authorization),
    );
    try {
      const authorized = await github.installationsForUser(
        await new GitHubAuthorization(db).token(req.userId),
      );
      return [...new Map([...personal, ...authorized].map((i) => [i.id, i])).values()];
    } catch (error) {
      if (error instanceof DomainError && error.statusCode === 401) return personal;
      throw error;
    }
  });
  app.post('/v1/github/connect', async (req) => {
    if (demo) throw new DomainError(409, 'GitHub connection is disabled in demo mode');
    const body = z.object({ installationId: z.number().int().positive() }).strict().parse(req.body);
    const githubId = await githubIdentity(req.headers.authorization);
    const github = new GitHubApp();
    let repos;
    if (await github.isAccountInstallation(githubId, body.installationId)) {
      repos = await github.repositories(body.installationId);
    } else {
      const token = await new GitHubAuthorization(db).token(req.userId);
      await github.verifyInstallation(token, body.installationId);
      repos = await github.repositoriesForUser(token, body.installationId);
    }
    await syncRepositories(db, req.userId, body.installationId, repos);
    return store.projects(req.userId);
  });
  app.post<{ Params: { id: string } }>('/v1/jobs/:id/ship', async (req, reply) => {
    const id = z.uuid().parse(req.params.id);
    const job = await store.job(req.userId, id);
    const body = z
      .object({
        kind: z.enum(['push', 'pr']),
        title: z.string().trim().min(3).max(200),
        approved: z.literal(true),
      })
      .strict()
      .parse(req.body);
    const key = z.string().min(8).max(100).parse(req.headers['idempotency-key']);
    if (job.status !== 'completed' || !job.report)
      throw new DomainError(409, 'Wait for the agent to finish');
    if (job.report.checkpointAvailable === false || !job.report.files.length)
      throw new DomainError(409, 'No saved changes available to publish');
    if (job.report.checks.some((c) => c.status === 'failed'))
      throw new DomainError(409, 'Resolve failing checks before shipping');
    const existing = (
      await db.query('SELECT status,data FROM actions WHERE user_id=$1 AND idempotency_key=$2', [
        req.userId,
        key,
      ])
    ).rows[0];
    if (existing) {
      const data = existing.data as any;
      if (data.jobId !== id || data.kind !== body.kind || data.title !== body.title)
        throw new DomainError(409, 'Idempotency key was used for a different action');
      return reply.code(existing.status === 'completed' ? 200 : 409).send(data);
    }
    const actionId = randomUUID();
    const branch = `pocket/${id.slice(0, 8)}-${actionId.slice(0, 8)}`;
    const action = { jobId: id, kind: body.kind, title: body.title, branch, demo };
    const inserted = await db.transaction(async (tx) => {
      const latest = (await tx.query('SELECT data FROM jobs WHERE id=$1 FOR UPDATE', [id])).rows[0]
        ?.data as any;
      if (latest?.report?.checkpointAvailable === false)
        throw new DomainError(409, 'Checkpoint was deleted');
      return tx.query(
        "INSERT INTO actions(id,user_id,job_id,kind,status,data,idempotency_key) VALUES($1,$2,$3,$4,'pending',$5,$6) ON CONFLICT(user_id,idempotency_key) DO NOTHING RETURNING id",
        [actionId, req.userId, id, body.kind, JSON.stringify(action), key],
      );
    });
    if (!inserted.rows.length) throw new DomainError(409, 'This action is already in progress');
    try {
      let result: unknown;
      if (demo)
        result = {
          ...action,
          message:
            body.kind === 'pr'
              ? 'Demo pull request prepared. No GitHub changes were made.'
              : 'Demo branch prepared. No GitHub changes were made.',
        };
      else {
        const project = (await store.project(req.userId, job.projectId)) as any;
        await repositoryAccess(req, project);
        const saved = await new SupabaseCheckpoints().get(job.report.snapshotRef);
        result = {
          ...action,
          ...(await new GitHubApp().ship(
            project.installationId,
            project.repositoryId,
            `${project.owner}/${project.name}`,
            job.branch,
            job.report.baseRef,
            branch,
            saved.changes,
            body.title,
            body.kind === 'pr',
          )),
        };
      }
      await db.query("UPDATE actions SET status='completed',data=$2 WHERE id=$1", [
        actionId,
        JSON.stringify(result),
      ]);
      await db.query('INSERT INTO audit(user_id,action,resource_id) VALUES($1,$2,$3)', [
        req.userId,
        `git.${body.kind}`,
        id,
      ]);
      return result;
    } catch (e) {
      await db.query("UPDATE actions SET status='failed',data=$2 WHERE id=$1", [
        actionId,
        JSON.stringify({
          ...action,
          message: 'Shipping was interrupted. Inspect the named GitHub branch before retrying.',
        }),
      ]);
      throw e;
    }
  });
  app.post('/github/webhook', { bodyLimit: 1024 * 1024 }, async (req, reply) => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) throw new DomainError(503, 'Webhook is not configured');
    const received = String(req.headers['x-hub-signature-256'] ?? '');
    const expected =
      'sha256=' +
      createHmac('sha256', secret)
        .update(req.rawBody ?? Buffer.alloc(0))
        .digest('hex');
    if (
      !/^sha256=[a-f0-9]{64}$/i.test(received) ||
      received.length !== expected.length ||
      !timingSafeEqual(Buffer.from(received), Buffer.from(expected))
    )
      throw new DomainError(401, 'Invalid webhook signature');
    const delivery = z.string().min(1).max(100).parse(req.headers['x-github-delivery']);
    const event = String(req.headers['x-github-event']);
    const body = req.body as {
      action?: string;
      installation?: { id: number };
      repositories_removed?: { id: number }[];
    };
    await db.transaction(async (tx) => {
      if (
        !(
          await tx.query(
            'INSERT INTO webhook_deliveries(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id',
            [delivery],
          )
        ).rows.length
      )
        return;
      if (
        (event === 'installation' && ['deleted', 'suspend'].includes(body.action ?? '')) ||
        (event === 'installation_repositories' && body.action === 'removed')
      ) {
        const removed = body.repositories_removed?.map((r) => String(r.id)) ?? [];
        const projects = (
          await tx.query("SELECT id FROM projects WHERE data->>'installationId'=$1", [
            String(body.installation?.id),
          ])
        ).rows;
        for (const row of projects) {
          const p = (await tx.query('SELECT data FROM projects WHERE id=$1', [row.id])).rows[0]
            ?.data as any;
          if (event === 'installation_repositories' && !removed.includes(String(p.repositoryId)))
            continue;
          await tx.query('DELETE FROM memberships WHERE project_id=$1', [row.id]);
          await tx.query(
            "UPDATE jobs SET status='cancelled',lease_token=NULL,data=jsonb_set(data,'{status}','\"cancelled\"') WHERE project_id=$1 AND status NOT IN ('completed','failed','cancelled')",
            [row.id],
          );
        }
      }
    });
    return reply.code(204).send();
  });
  const preview = demo ? fileURLToPath(new URL('../../preview/', import.meta.url)) : '';
  for (const [url, file, mime] of [
    ['/', 'index.html', 'text/html'],
    ['/style.css', 'style.css', 'text/css'],
    ['/app.js', 'app.js', 'application/javascript'],
  ]) {
    if (demo)
      app.get(url!, async (_req, reply) =>
        reply
          .header(
            'Content-Security-Policy',
            "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          )
          .type(mime!)
          .send(await readFile(`${preview}${file}`)),
      );
  }
  return { app, store };
}
declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
    rawBody: Buffer | null;
  }
}
