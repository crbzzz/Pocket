import { randomUUID } from 'node:crypto';
import type { SQL } from './database.js';
import {
  DomainError,
  terminal,
  type Job,
  type Project,
  type Report,
  type Save,
  type Phase,
  type Event,
} from './domain.js';
export interface Lease {
  job: Job;
  token: string;
}
export interface JobQueue {
  claim(id?: string): Promise<Lease | null>;
  heartbeat(id: string, token: string): Promise<boolean>;
}
export class Store implements JobQueue {
  constructor(public db: SQL) {}
  async project(user: string, id: string): Promise<Project> {
    const { rows } = await this.db.query(
      "SELECT p.data - 'repositoryIndex' AS data FROM projects p JOIN memberships m ON p.id=m.project_id WHERE m.user_id=$1 AND p.id=$2",
      [user, id],
    );
    if (!rows[0]) throw new DomainError(404, 'Project not found');
    return rows[0].data as unknown as Project;
  }
  async projects(user: string): Promise<Project[]> {
    return (
      await this.db.query(
        "SELECT p.data - 'repositoryIndex' AS data FROM projects p JOIN memberships m ON p.id=m.project_id WHERE m.user_id=$1 ORDER BY p.data->>'name'",
        [user],
      )
    ).rows.map((r) => r.data as unknown as Project);
  }
  async job(user: string, id: string): Promise<Job> {
    const { rows } = await this.db.query(
      'SELECT j.data FROM jobs j JOIN memberships m ON j.project_id=m.project_id WHERE j.id=$1 AND j.user_id=$2 AND m.user_id=$2',
      [id, user],
    );
    if (!rows[0]) throw new DomainError(404, 'Agent not found');
    return rows[0].data as unknown as Job;
  }
  async jobs(user: string, includeArchived = false): Promise<Job[]> {
    return (
      await this.db.query(
        `SELECT CASE WHEN j.data->'report' IS NOT NULL AND j.data->'report'<>'null'::jsonb
          THEN jsonb_set(j.data,'{report,files}',coalesce((SELECT jsonb_agg(f || '{"patch":""}'::jsonb) FROM jsonb_array_elements(j.data#>'{report,files}') f),'[]'::jsonb))
          ELSE j.data END AS data
          FROM jobs j JOIN memberships m ON j.project_id=m.project_id WHERE j.user_id=$1 AND m.user_id=$1 AND ($2 OR coalesce(j.data->>'archived','false')<>'true') ORDER BY j.created_at DESC LIMIT 100`,
        [user, includeArchived],
      )
    ).rows.map((r) => r.data as unknown as Job);
  }
  async create(
    user: string,
    input: Pick<Job, 'projectId' | 'branch' | 'prompt' | 'modelId' | 'maxCostCents'> &
      Pick<Job, 'baseJobId' | 'attachments'>,
    key: string,
    demo: boolean,
  ): Promise<Job> {
    const project = await this.project(user, input.projectId);
    if (input.baseJobId) {
      const base = await this.job(user, input.baseJobId);
      if (
        base.projectId !== input.projectId ||
        base.branch !== input.branch ||
        base.status !== 'completed' ||
        !base.report?.snapshotRef ||
        base.report.checkpointAvailable === false
      )
        throw new DomainError(409, 'Choose an available checkpoint on this branch');
    }
    if (!project.branches.includes(input.branch))
      throw new DomainError(400, 'Branch is not available');
    return this.db.transaction(async (db) => {
      // Lock the user's row to serialize submissions across API instances.
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user]);
      await db.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [input.projectId]);
      const existing = (
        await db.query('SELECT data FROM jobs WHERE user_id=$1 AND idempotency_key=$2', [user, key])
      ).rows[0];
      if (existing) {
        const job = existing.data as unknown as Job;
        if (
          Object.entries(input).some(
            ([k, v]) =>
              JSON.stringify(job[k as keyof Job] ?? (k === 'attachments' ? [] : undefined)) !==
              JSON.stringify(v),
          )
        )
          throw new DomainError(409, 'Idempotency key was used for a different request');
        return job;
      }
      const active = (
        await db.query(
          "SELECT count(*)::int AS count FROM jobs WHERE user_id=$1 AND status NOT IN ('completed','failed','cancelled')",
          [user],
        )
      ).rows[0]?.count as number;
      if (active >= 2) throw new DomainError(429, 'Your two agent slots are in use');
      const job: Job = {
        id: randomUUID(),
        ...input,
        status: 'queued',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        report: null,
        error: null,
        demo,
      };
      await db.query(
        'INSERT INTO jobs(id,user_id,project_id,data,status,idempotency_key) VALUES($1,$2,$3,$4,$5,$6)',
        [job.id, user, input.projectId, JSON.stringify(job), job.status, key],
      );
      await db.query(
        "INSERT INTO events(job_id,phase,message) VALUES($1,'queued','Waiting for an agent slot')",
        [job.id],
      );
      await db.query("INSERT INTO audit(user_id,action,resource_id) VALUES($1,'task.created',$2)", [
        user,
        job.id,
      ]);
      return job;
    });
  }
  async claim(id?: string): Promise<Lease | null> {
    return this.db.transaction(async (db) => {
      // A crashed lease is failed rather than replaying an external side effect.
      const expired = (
        await db.query(
          "SELECT id,data FROM jobs WHERE status NOT IN ('queued','completed','failed','cancelled') AND lease_until < now() FOR UPDATE SKIP LOCKED",
        )
      ).rows;
      for (const row of expired) {
        const job = row.data as unknown as Job;
        job.status = 'failed';
        job.error = 'Worker lease expired. Start a new task from the latest Save.';
        job.updatedAt = new Date().toISOString();
        await db.query("UPDATE jobs SET status='failed',data=$2,lease_token=NULL WHERE id=$1", [
          row.id,
          JSON.stringify(job),
        ]);
        await db.query("INSERT INTO events(job_id,phase,message) VALUES($1,'failed',$2)", [
          row.id,
          job.error,
        ]);
      }
      const row = (
        await db.query(
          "SELECT id,data FROM jobs WHERE status='queued' AND ($1::uuid IS NULL OR id=$1) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
          [id ?? null],
        )
      ).rows[0];
      if (!row) return null;
      const job = row.data as unknown as Job;
      job.status = 'analyzing';
      job.updatedAt = new Date().toISOString();
      const token = randomUUID();
      await db.query(
        "UPDATE jobs SET status='analyzing',data=$2,lease_until=now()+interval '90 seconds',lease_token=$3,attempts=attempts+1 WHERE id=$1",
        [job.id, JSON.stringify(job), token],
      );
      await db.query(
        "INSERT INTO events(job_id,phase,message) VALUES($1,'analyzing','Analyzing repository')",
        [job.id],
      );
      return { job, token };
    });
  }
  async heartbeat(id: string, token: string): Promise<boolean> {
    return (
      (
        await this.db.query(
          "UPDATE jobs SET lease_until=now()+interval '90 seconds' WHERE id=$1 AND lease_token=$2 AND status NOT IN ('completed','failed','cancelled') RETURNING id",
          [id, token],
        )
      ).rows.length > 0
    );
  }
  async setIntent(id: string, token: string, intent: 'analysis' | 'change') {
    const r = await this.db.query(
      "UPDATE jobs SET data=jsonb_set(data,'{intent}',to_jsonb($3::text)) WHERE id=$1 AND lease_token=$2 AND status='analyzing' RETURNING id",
      [id, token, intent],
    );
    if (!r.rows.length) throw new DomainError(409, 'Task cancelled');
  }
  async transition(
    id: string,
    token: string,
    phase: Phase,
    message: string,
    report?: Report,
  ): Promise<boolean> {
    return this.db.transaction(async (db) => {
      const row = (
        await db.query(
          'SELECT data,project_id FROM jobs WHERE id=$1 AND lease_token=$2 FOR UPDATE',
          [id, token],
        )
      ).rows[0];
      if (!row) return false;
      const job = row.data as unknown as Job;
      if (terminal.has(job.status)) return false;
      const allowed: Record<string, Phase[]> = {
        analyzing: ['planning', 'failed'],
        planning: ['editing', 'failed'],
        editing: ['testing', 'completed', 'failed'],
        testing: ['completed', 'failed'],
      };
      if (!allowed[job.status]?.includes(phase))
        throw new DomainError(409, `Invalid transition from ${job.status} to ${phase}`);
      job.status = phase;
      job.updatedAt = new Date().toISOString();
      if (report) job.report = report;
      if (phase === 'failed') job.error = message;
      await db.query('UPDATE jobs SET status=$2,data=$3 WHERE id=$1', [
        id,
        phase,
        JSON.stringify(job),
      ]);
      await db.query('INSERT INTO events(job_id,phase,message) VALUES($1,$2,$3)', [
        id,
        phase,
        message,
      ]);
      if (phase === 'completed' && report && report.checkpointAvailable !== false) {
        await db.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [job.projectId]);
        const number =
          ((
            await db.query('SELECT count(*)::int AS count FROM saves WHERE project_id=$1', [
              job.projectId,
            ])
          ).rows[0]?.count as number) + 1;
        const save: Save = {
          id: randomUUID(),
          projectId: job.projectId,
          jobId: id,
          branch: job.branch,
          number,
          title: job.prompt.slice(0, 80),
          snapshotRef: report.snapshotRef,
          createdAt: new Date().toISOString(),
        };
        await db.query(
          'INSERT INTO saves(id,project_id,job_id,data) VALUES($1,$2,$3,$4) ON CONFLICT(job_id) DO NOTHING',
          [save.id, save.projectId, id, JSON.stringify(save)],
        );
        const p = (await db.query('SELECT data FROM projects WHERE id=$1', [job.projectId])).rows[0]
          ?.data as unknown as Project;
        p.branchSaves = { ...p.branchSaves, [job.branch]: report.snapshotRef };
        p.memory.recentWork = [report.summary.slice(0, 1000), ...p.memory.recentWork].slice(0, 5);
        p.updatedAt = new Date().toISOString();
        await db.query('UPDATE projects SET data=$2 WHERE id=$1', [p.id, JSON.stringify(p)]);
      }
      return true;
    });
  }
  async cancel(user: string, id: string): Promise<Job> {
    await this.job(user, id);
    return this.db.transaction(async (db) => {
      const job = (await db.query('SELECT data FROM jobs WHERE id=$1 FOR UPDATE', [id])).rows[0]
        ?.data as unknown as Job;
      if (terminal.has(job.status)) return job;
      job.status = 'cancelled';
      job.updatedAt = new Date().toISOString();
      await db.query("UPDATE jobs SET status='cancelled',data=$2,lease_token=NULL WHERE id=$1", [
        id,
        JSON.stringify(job),
      ]);
      await db.query(
        "INSERT INTO events(job_id,phase,message) VALUES($1,'cancelled','Cancelled by you')",
        [id],
      );
      return job;
    });
  }
  async events(user: string, id: string, after: number): Promise<Event[]> {
    await this.job(user, id);
    return (
      await this.db.query(
        'SELECT sequence,job_id,phase,message,created_at FROM events WHERE job_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 200',
        [id, after],
      )
    ).rows.map((r) => ({
      sequence: Number(r.sequence),
      jobId: r.job_id as string,
      phase: r.phase as Phase,
      message: r.message as string,
      createdAt: new Date(r.created_at as string).toISOString(),
    }));
  }
  async deleteJob(user: string, id: string) {
    await this.job(user, id);
    const result = await this.db.query(
      "UPDATE jobs SET data=jsonb_set(data,'{archived}','true') WHERE id=$1 AND user_id=$2 AND status IN ('completed','failed','cancelled') RETURNING id",
      [id, user],
    );
    if (!result.rows.length)
      throw new DomainError(409, 'Cancel the running task before deleting it');
    return { deleted: true };
  }
  async deleteSave(user: string, projectId: string, id: string): Promise<string> {
    await this.project(user, projectId);
    return this.db.transaction(async (db) => {
      const row = (
        await db.query(
          'SELECT s.data FROM saves s JOIN jobs j ON j.id=s.job_id WHERE s.id=$1 AND s.project_id=$2 AND j.user_id=$3 FOR UPDATE OF j',
          [id, projectId, user],
        )
      ).rows[0];
      if (!row) throw new DomainError(404, 'Checkpoint not found');
      const save = row.data as unknown as Save;
      await db.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [projectId]);
      const busy = (
        await db.query(
          "SELECT id FROM jobs WHERE project_id=$1 AND status NOT IN ('completed','failed','cancelled') UNION ALL SELECT id FROM actions WHERE job_id=$2 AND status='pending'",
          [projectId, save.jobId],
        )
      ).rows;
      if (busy.length)
        throw new DomainError(
          409,
          'Wait for running tasks and publishing to finish before deleting this checkpoint',
        );
      await db.query('UPDATE saves SET data=data || \'{"deleted":true}\'::jsonb WHERE id=$1', [id]);
      await db.query(
        "UPDATE jobs SET data=jsonb_set(data,'{report,checkpointAvailable}','false') WHERE id=$1",
        [save.jobId],
      );
      const p = (await db.query('SELECT data FROM projects WHERE id=$1', [projectId])).rows[0]!
        .data as unknown as Project;
      if ((p as Project & { restoreRef?: string }).restoreRef === save.snapshotRef)
        delete (p as Project & { restoreRef?: string }).restoreRef;
      p.branchSaves = Object.fromEntries(
        Object.entries(p.branchSaves ?? {}).filter(([, ref]) => ref !== save.snapshotRef),
      );
      await db.query('UPDATE projects SET data=$2 WHERE id=$1', [projectId, JSON.stringify(p)]);
      return save.snapshotRef;
    });
  }
  async saves(user: string, id: string): Promise<Save[]> {
    await this.project(user, id);
    return (
      await this.db.query(
        "SELECT s.data || jsonb_build_object('canDelete', j.user_id=$2) AS data FROM saves s JOIN jobs j ON j.id=s.job_id WHERE s.project_id=$1 AND coalesce(s.data->>'deleted','false')<>'true' ORDER BY (s.data->>'number')::int DESC",
        [id, user],
      )
    ).rows.map((r) => r.data as unknown as Save);
  }
  async restore(
    user: string,
    projectId: string,
    saveId: string,
    branch?: string,
  ): Promise<Project> {
    const project = await this.project(user, projectId);
    branch = branch ?? project.branch;
    if (!project.branches.includes(branch)) throw new DomainError(400, 'Branch is not available');
    return this.db.transaction(async (db) => {
      await db.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [projectId]);
      const row = (
        await db.query(
          "SELECT data FROM saves WHERE id=$1 AND project_id=$2 AND coalesce(data->>'deleted','false')<>'true'",
          [saveId, projectId],
        )
      ).rows[0];
      if (!row) throw new DomainError(404, 'Save not found');
      const save = row.data as unknown as Save;
      // A restore selects the Git snapshot for the next sandbox. No force push.
      const p = (await db.query('SELECT data FROM projects WHERE id=$1', [projectId])).rows[0]
        ?.data as unknown as Project;
      p.branchSaves = { ...p.branchSaves, [branch!]: save.snapshotRef };
      await db.query('UPDATE projects SET data=$2 WHERE id=$1', [projectId, JSON.stringify(p)]);
      await db.query(
        "INSERT INTO audit(user_id,action,resource_id) VALUES($1,'save.restored',$2)",
        [user, saveId],
      );
      return (await db.query('SELECT data FROM projects WHERE id=$1', [projectId])).rows[0]
        ?.data as unknown as Project;
    });
  }
}
