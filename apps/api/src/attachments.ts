import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { DomainError } from './domain.js';
import type { SQL } from './sql.js';
export class Attachments {
  private client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  constructor(private db: SQL) {}
  async upload(user: string, mimeType: string, encoded: string) {
    const bytes = Buffer.from(encoded, 'base64');
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (
      bytes.length > 500000 ||
      !((mimeType === 'image/jpeg' && jpeg) || (mimeType === 'image/png' && png))
    )
      throw new DomainError(400, 'Choose a JPEG or PNG image smaller than 500 KB');
    const id = randomUUID(),
      path = `${user}/${id}`;
    await this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user]);
      const quota = (
        await tx.query(
          'SELECT coalesce(sum(size),0)::int AS bytes FROM attachments WHERE user_id=$1',
          [user],
        )
      ).rows[0];
      if (Number(quota?.bytes) + bytes.length > 20000000)
        throw new DomainError(409, 'Image storage limit reached');
      await tx.query('INSERT INTO attachments(id,user_id,mime_type,size) VALUES($1,$2,$3,$4)', [
        id,
        user,
        mimeType,
        bytes.length,
      ]);
    });
    const { error } = await this.client.storage
      .from('pocket-attachments')
      .upload(path, bytes, { contentType: mimeType, upsert: false });
    if (error) {
      await this.db.query('DELETE FROM attachments WHERE id=$1', [id]);
      throw new DomainError(502, 'Image upload failed. Try again.');
    }
    return { id, mimeType };
  }
  async owned(user: string, ids: string[]) {
    if (!ids.length) return [];
    const rows = (
      await this.db.query<{ id: string; mime_type: string }>(
        'SELECT id,mime_type FROM attachments WHERE user_id=$1 AND id=ANY($2::uuid[])',
        [user, ids],
      )
    ).rows;
    if (rows.length !== new Set(ids).size) throw new DomainError(404, 'Image unavailable');
    return rows;
  }
  async images(user: string, ids: string[]) {
    const owned = await this.owned(user, ids);
    return Promise.all(
      owned.map(async (row) => {
        const { data, error } = await this.client.storage
          .from('pocket-attachments')
          .download(`${user}/${row.id}`);
        if (error || !data) throw new DomainError(404, 'Image unavailable. Attach it again.');
        return {
          mimeType: row.mime_type,
          data: Buffer.from(await data.arrayBuffer()).toString('base64'),
        };
      }),
    );
  }
  async url(user: string, id: string) {
    await this.owned(user, [id]);
    const { data, error } = await this.client.storage
      .from('pocket-attachments')
      .createSignedUrl(`${user}/${id}`, 600);
    if (error || !data) throw new DomainError(404, 'Image unavailable');
    return { url: data.signedUrl };
  }
  async remove(user: string, id: string) {
    await this.owned(user, [id]);
    const used = (
      await this.db.query(
        "SELECT id FROM jobs WHERE user_id=$1 AND data->'attachments' ? $2 LIMIT 1",
        [user, id],
      )
    ).rows;
    if (used.length) throw new DomainError(409, 'This image belongs to a conversation');
    const { error } = await this.client.storage
      .from('pocket-attachments')
      .remove([`${user}/${id}`]);
    if (error) throw new DomainError(502, 'Image deletion failed');
    await this.db.query('DELETE FROM attachments WHERE id=$1 AND user_id=$2', [id, user]);
    return { deleted: true };
  }
}
