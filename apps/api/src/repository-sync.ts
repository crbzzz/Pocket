import { randomUUID } from 'node:crypto';
import type { SQL } from './sql.js';
import type { Repo } from './github.js';

// Caller must verify this user's access to the installation and repository list.
// Bulk upserts avoid per-repository connections and preserve project memory/history.
export async function syncRepositories(
  db: SQL,
  userId: string,
  installationId: number,
  repositories: Repo[],
): Promise<void> {
  const projects = repositories.map((repo) => ({
    id: randomUUID(),
    name: repo.name,
    owner: repo.owner.login,
    description: repo.description ?? '',
    language: repo.language ?? '',
    color: '#819477',
    branch: repo.default_branch,
    branches: [repo.default_branch],
    memory: {
      stack: repo.language ? [repo.language] : [],
      objective: '',
      decisions: [],
      recentWork: [],
    },
    installationId,
    repositoryId: repo.id,
    updatedAt: new Date().toISOString(),
  }));
  await db.transaction(async (tx) => {
    await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
    const inserted = await tx.query<{ id: string }>(
      `
      INSERT INTO projects(id,data)
      SELECT (value->>'id')::uuid,value FROM jsonb_array_elements($1::jsonb)
      ON CONFLICT ((data->>'installationId'),(data->>'repositoryId'))
      WHERE data->>'repositoryId' IS NOT NULL
      DO UPDATE SET data=projects.data || jsonb_build_object(
        'name',excluded.data->'name','owner',excluded.data->'owner',
        'description',excluded.data->'description','language',excluded.data->'language',
        'updatedAt',excluded.data->'updatedAt')
      RETURNING id`,
      [JSON.stringify(projects)],
    );
    const ids = inserted.rows.map((row) => row.id);
    await tx.query(
      'INSERT INTO memberships(user_id,project_id) SELECT $1::uuid,id FROM unnest($2::uuid[]) AS id ON CONFLICT DO NOTHING',
      [userId, ids],
    );
    await tx.query(
      `DELETE FROM memberships m USING projects p WHERE m.project_id=p.id
      AND m.user_id=$1 AND p.data->>'installationId'=$2 AND NOT (p.id=ANY($3::uuid[]))`,
      [userId, String(installationId), ids],
    );
  });
}
