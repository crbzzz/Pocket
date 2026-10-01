import { createClient } from '@supabase/supabase-js';
import type { Change } from './github.js';
export interface Checkpoint {
  bundle: Buffer;
  changes: Change[];
  commit: string;
  baseRef: string;
}
export interface CheckpointStorage {
  put(projectId: string, jobId: string, value: Checkpoint): Promise<string>;
  get(ref: string): Promise<Checkpoint>;
}
export class SupabaseCheckpoints implements CheckpointStorage {
  private client;
  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Private checkpoint storage is not configured');
    this.client = createClient(url, key, { auth: { persistSession: false } });
  }
  async put(project: string, job: string, value: Checkpoint): Promise<string> {
    const path = `${project}/${job}.json`;
    const body = Buffer.from(JSON.stringify({ ...value, bundle: value.bundle.toString('base64') }));
    if (body.length > 28 * 1024 * 1024)
      throw new Error('Checkpoint exceeds 28 MB; large-repository storage needs configuration');
    const { error } = await this.client.storage
      .from('pocket-checkpoints')
      .upload(path, body, { contentType: 'application/json', upsert: false });
    if (error) throw new Error('Checkpoint upload failed');
    return path;
  }
  async get(ref: string): Promise<Checkpoint> {
    if (!/^[a-f0-9-]+\/[a-f0-9-]+\.json$/.test(ref))
      throw new Error('Invalid checkpoint reference');
    const { data, error } = await this.client.storage.from('pocket-checkpoints').download(ref);
    if (error || !data) throw new Error('Checkpoint unavailable');
    const d = JSON.parse(await data.text());
    return { ...d, bundle: Buffer.from(d.bundle, 'base64') };
  }
}
