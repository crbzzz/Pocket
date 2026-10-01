import type { SQL } from './database.js';
import { demoUser, projects, demoReport } from './fixtures.js';
import type { Job } from './domain.js';
export async function seed(db: SQL) {
  await db.query("INSERT INTO users(id,name) VALUES($1,'Edouard') ON CONFLICT DO NOTHING", [
    demoUser,
  ]);
  for (const p of projects) {
    await db.query('INSERT INTO projects(id,data) VALUES($1,$2) ON CONFLICT DO NOTHING', [
      p.id,
      JSON.stringify(p),
    ]);
    await db.query(
      'INSERT INTO memberships(user_id,project_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [demoUser, p.id],
    );
  }
  const job: Job = {
    id: '00000000-0000-4000-8000-000000000020',
    projectId: projects[0]!.id,
    branch: 'main',
    prompt:
      "Make the dashboard responsive and fix the sidebar on mobile. Don't change the backend.",
    modelId: 'auto',
    status: 'completed',
    maxCostCents: 300,
    createdAt: new Date(Date.now() - 480000).toISOString(),
    updatedAt: new Date(Date.now() - 420000).toISOString(),
    report: demoReport,
    error: null,
    demo: true,
  };
  await db.query(
    'INSERT INTO jobs(id,user_id,project_id,data,status,idempotency_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
    [job.id, demoUser, job.projectId, JSON.stringify(job), job.status, 'seed'],
  );
  const save = {
    id: '00000000-0000-4000-8000-000000000030',
    projectId: job.projectId,
    jobId: job.id,
    branch: job.branch,
    number: 1,
    title: 'Mobile dashboard fixes',
    snapshotRef: demoReport.snapshotRef,
    createdAt: job.updatedAt,
  };
  await db.query(
    'INSERT INTO saves(id,project_id,job_id,data) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
    [save.id, save.projectId, save.jobId, JSON.stringify(save)],
  );
}
