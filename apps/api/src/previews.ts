import { randomUUID } from 'node:crypto';
import type { SQL } from './sql.js';
import { Store } from './store.js';
import { DomainError } from './domain.js';
import { quote, type SandboxProvider, type SandboxHandle } from './sandbox.js';
import type { GitProvider } from './github.js';
import type { CheckpointStorage } from './artifacts.js';
export interface Preview {
  id: string;
  jobId: string;
  status: string;
  stage: string;
  url?: string;
  logs?: string;
  error?: string;
  expiresAt: string;
  sandboxId?: string;
}
export function previewPlan(
  paths: string[],
  packageText?: string,
): { directory: string; install?: string; command: string } {
  if (packageText) {
    const pkg = JSON.parse(packageText);
    const scripts = pkg.scripts ?? {};
    const name =
      typeof scripts.dev === 'string'
        ? 'dev'
        : typeof scripts.start === 'string'
          ? 'start'
          : undefined;
    if (name && !/expo|react-native/i.test(scripts[name])) {
      const isNext = /\bnext\b/.test(scripts[name]),
        host = isNext ? '--hostname' : '--host';
      const args = /vite|next|astro|nuxt/i.test(scripts[name])
        ? ` -- ${host} 0.0.0.0 --port 3000`
        : '';
      let manager = 'npm',
        install = 'npm install --no-audit --no-fund';
      if (paths.includes('pnpm-lock.yaml')) {
        manager = 'pnpm';
        install =
          '(command -v pnpm >/dev/null || npm install -g pnpm) && pnpm install --no-frozen-lockfile';
      } else if (paths.includes('yarn.lock')) {
        manager = 'yarn';
        install = '(command -v yarn >/dev/null || npm install -g yarn) && yarn install';
      }
      return {
        directory: '.',
        install,
        command: `HOST=0.0.0.0 PORT=3000 ${manager} run ${name}${args}`,
      };
    }
  }
  if (paths.includes('index.html'))
    return { directory: '.', command: 'python3 -m http.server 3000 --bind 0.0.0.0' };
  throw new DomainError(
    422,
    'No supported web preview found. Add a web dev/start script or an index.html.',
  );
}
export class Previews {
  constructor(
    private db: SQL,
    private store: Store,
    private sandbox: SandboxProvider,
    private git: GitProvider,
    private storage: CheckpointStorage,
  ) {}
  private public(p: Preview) {
    const { sandboxId, ...rest } = p;
    return rest;
  }
  async get(user: string, id: string) {
    const row = (
      await this.db.query<{ data: Preview; status: string }>(
        'SELECT data,status FROM previews WHERE id=$1 AND user_id=$2',
        [id, user],
      )
    ).rows[0];
    if (!row) throw new DomainError(404, 'Preview not found');
    const p = { ...row.data, status: row.status };
    if (Date.parse(p.expiresAt) <= Date.now() && !['closed', 'failed'].includes(p.status)) {
      await this.stop(user, id);
      return { ...this.public(p), status: 'closed', url: undefined };
    }
    return this.public(p);
  }
  async create(user: string, jobId: string) {
    const job = await this.store.job(user, jobId);
    if (
      job.status !== 'completed' ||
      job.report?.checkpointAvailable === false ||
      !job.report?.snapshotRef
    )
      throw new DomainError(409, 'Complete a coding task before opening its preview');
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user]);
      const active = (
        await tx.query<{ data: Preview }>(
          "SELECT data || jsonb_build_object('status',status) AS data FROM previews WHERE user_id=$1 AND status IN ('queued','starting','ready') AND expires_at>now() LIMIT 1",
          [user],
        )
      ).rows[0];
      if (active) {
        if (active.data.jobId === jobId) return this.public(active.data);
        throw new DomainError(409, 'Close your current preview before opening another');
      }
      const p: Preview = {
        id: randomUUID(),
        jobId,
        status: 'queued',
        stage: 'Preparing preview',
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      };
      await tx.query(
        'INSERT INTO previews(id,user_id,job_id,data,expires_at,status) VALUES($1,$2,$3,$4,$5,$6)',
        [p.id, user, jobId, JSON.stringify(p), p.expiresAt, p.status],
      );
      return p;
    });
  }
  async start(user: string, id: string) {
    const p = await this.get(user, id);
    const claimed = (
      await this.db.query(
        "UPDATE previews SET status='starting' WHERE id=$1 AND user_id=$2 AND status='queued' RETURNING id",
        [id, user],
      )
    ).rows.length;
    if (!claimed) return this.get(user, id);
    let sandbox: SandboxHandle | undefined;
    const update = async (data: Partial<Preview>, status = 'starting') => {
      const ok = (
        await this.db.query(
          "UPDATE previews SET data=data||$2::jsonb,status=$3 WHERE id=$1 AND status='starting' AND expires_at>now() RETURNING id",
          [id, JSON.stringify(data), status],
        )
      ).rows.length;
      if (!ok) throw new Error('Preview closed or expired');
    };
    try {
      const job = await this.store.job(user, p.jobId),
        project = (await this.store.project(user, job.projectId)) as any;
      const token = await this.git.readToken(project.installationId, project.repositoryId);
      sandbox = await this.sandbox.create(
        id,
        `${project.owner}/${project.name}`,
        job.branch,
        token,
      );
      await update({ sandboxId: sandbox.id, stage: 'Restoring checkpoint' });
      const saved = await this.storage.get(job.report!.snapshotRef);
      await sandbox.restore(saved.bundle, saved.commit);
      const tree = (await sandbox.exec('git ls-files | head -500', 10)).output.split('\n');
      let plan: ReturnType<typeof previewPlan> | undefined;
      for (const directory of ['.', 'apps/web', 'web', 'frontend', 'client']) {
        const prefix = directory === '.' ? '' : directory + '/';
        const paths = tree.filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length));
        if (!paths.includes('package.json') && !paths.includes('index.html')) continue;
        try {
          plan = previewPlan(
            paths,
            paths.includes('package.json')
              ? await sandbox.read(prefix + 'package.json')
              : undefined,
          );
          plan.directory = directory;
          break;
        } catch (e) {
          if (!(e instanceof DomainError) && !(e instanceof SyntaxError)) throw e;
        }
      }
      if (!plan)
        throw new Error(
          'This checkpoint has no supported web app. Preview supports web dev/start scripts and static HTML.',
        );
      if (plan.install) {
        await update({ stage: 'Installing dependencies' });
        const install = await sandbox.exec(`cd ${quote(plan.directory)} && ${plan.install}`, 120);
        await update({ logs: install.output.slice(-12000) });
        if (install.exitCode !== 0)
          throw new Error(
            'Dependency installation failed. Review the output and ask Pocket to fix it.',
          );
      }
      await update({ stage: 'Starting web app' });
      if (!sandbox.preview) throw new Error('This sandbox provider does not support web previews');
      const seconds = Math.max(1, Math.floor((Date.parse(p.expiresAt) - Date.now()) / 1000));
      const url = await sandbox.preview(
        `cd ${quote(plan.directory)} && ${plan.command}`,
        3000,
        seconds,
      );
      if (!url.startsWith('https://')) throw new Error('Preview requires HTTPS');
      await update(
        { stage: 'Ready', url, logs: (await sandbox.previewLogs?.())?.slice(-12000) },
        'ready',
      );
    } catch (e) {
      const logs = await sandbox?.previewLogs?.().catch(() => undefined);
      await this.db.query(
        "UPDATE previews SET status='failed',data=data||$2::jsonb WHERE id=$1 AND status='starting'",
        [
          id,
          JSON.stringify({
            error: e instanceof Error ? e.message : 'Preview failed',
            ...(logs ? { logs: logs.slice(-12000) } : {}),
          }),
        ],
      );
      if (sandbox) {
        try {
          await sandbox.destroy();
          await this.db.query(
            'UPDATE previews SET data=data||\'{"destroyed":true}\'::jsonb WHERE id=$1',
            [id],
          );
        } catch {}
      }
    }
    return this.get(user, id);
  }
  async stop(user: string, id: string) {
    const row = (
      await this.db.query<{ data: Preview }>(
        'SELECT data FROM previews WHERE id=$1 AND user_id=$2',
        [id, user],
      )
    ).rows[0];
    if (!row) throw new DomainError(404, 'Preview not found');
    await this.db.query(
      "UPDATE previews SET status='closed',data=data-'url' WHERE id=$1 AND user_id=$2",
      [id, user],
    );
    if (row.data.sandboxId && this.sandbox.attach)
      try {
        await (await this.sandbox.attach(row.data.sandboxId)).destroy();
        await this.db.query(
          'UPDATE previews SET data=data||\'{"destroyed":true}\'::jsonb WHERE id=$1',
          [id],
        );
      } catch {
        console.error(JSON.stringify({ event: 'preview.cleanup.failed', previewId: id }));
      }
    if (!row.data.sandboxId)
      await this.db.query(
        'UPDATE previews SET data=data||\'{"destroyed":true}\'::jsonb WHERE id=$1',
        [id],
      );
    return { closed: true };
  }
}
