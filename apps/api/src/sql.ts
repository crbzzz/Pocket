export interface SQL {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
  transaction<T>(fn: (sql: SQL) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function migrate(db: SQL) {
  const schema = `CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY, name text NOT NULL);
    CREATE TABLE IF NOT EXISTS projects (id uuid PRIMARY KEY, data jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS memberships (user_id uuid REFERENCES users(id), project_id uuid REFERENCES projects(id), PRIMARY KEY(user_id,project_id));
    CREATE TABLE IF NOT EXISTS jobs (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), project_id uuid NOT NULL REFERENCES projects(id), data jsonb NOT NULL, status text NOT NULL, idempotency_key text NOT NULL, lease_until timestamptz, lease_token uuid, attempts integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,idempotency_key));
    CREATE TABLE IF NOT EXISTS events (sequence bigserial PRIMARY KEY, job_id uuid NOT NULL REFERENCES jobs(id), phase text NOT NULL, message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS saves (id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), job_id uuid NOT NULL REFERENCES jobs(id), data jsonb NOT NULL, UNIQUE(job_id));
    CREATE TABLE IF NOT EXISTS actions (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), job_id uuid NOT NULL REFERENCES jobs(id), kind text NOT NULL, status text NOT NULL, data jsonb NOT NULL, idempotency_key text NOT NULL, UNIQUE(user_id,idempotency_key));
    CREATE TABLE IF NOT EXISTS audit (id bigserial PRIMARY KEY, user_id uuid REFERENCES users(id), action text NOT NULL, resource_id uuid, created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status,created_at);
    CREATE INDEX IF NOT EXISTS events_job ON events(job_id,sequence);
    CREATE INDEX IF NOT EXISTS saves_project ON saves(project_id);
    CREATE TABLE IF NOT EXISTS github_oauth_states (hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), github_id text NOT NULL, expires_at timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS github_user_grants (user_id uuid PRIMARY KEY REFERENCES users(id), encrypted_token text NOT NULL, expires_at timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS webhook_deliveries (id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS usage (id bigserial PRIMARY KEY, job_id uuid NOT NULL REFERENCES jobs(id), input_tokens integer NOT NULL, output_tokens integer NOT NULL, cost_cents numeric NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS attachments (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), mime_type text NOT NULL, size integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS previews (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), job_id uuid NOT NULL REFERENCES jobs(id), data jsonb NOT NULL, expires_at timestamptz NOT NULL, status text NOT NULL);
    CREATE INDEX IF NOT EXISTS previews_expiry ON previews(status,expires_at);
    CREATE UNIQUE INDEX IF NOT EXISTS projects_github_repo ON projects ((data->>'installationId'),(data->>'repositoryId')) WHERE data->>'repositoryId' IS NOT NULL;`;
  await db.transaction(async (tx) => {
    for (const statement of schema
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean))
      await tx.query(statement);
  });
}
