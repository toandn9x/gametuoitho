import { DatabaseClient } from './db';
import { UploadJob, UploadJobStatus } from '@gametuoitho/shared-types';

export class UploadJobRepository {
  constructor(private db: DatabaseClient) {}

  async create(job: {
    id: string;
    user_id: string;
    asset_id: string;
    status?: UploadJobStatus;
    error_message?: string | null;
  }): Promise<void> {
    await this.db.execute(
      `INSERT INTO upload_jobs (id, user_id, asset_id, status, error_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [job.id, job.user_id, job.asset_id, job.status || 'PENDING', job.error_message || null]
    );
  }

  async updateStatus(id: string, status: UploadJobStatus, errorMessage?: string | null): Promise<void> {
    await this.db.execute(
      `UPDATE upload_jobs 
       SET status = ?, error_message = ?, updated_at = datetime('now') 
       WHERE id = ?`,
      [status, errorMessage || null, id]
    );
  }

  async findById(id: string): Promise<UploadJob | null> {
    return this.db.queryFirst<UploadJob>('SELECT * FROM upload_jobs WHERE id = ?', [id]);
  }

  async findByAssetId(assetId: string): Promise<UploadJob | null> {
    return this.db.queryFirst<UploadJob>('SELECT * FROM upload_jobs WHERE asset_id = ? ORDER BY created_at DESC LIMIT 1', [assetId]);
  }

  async countRecentUploadsByUser(userId: string, windowSeconds = 60): Promise<number> {
    const row = await this.db.queryFirst<{ count: number }>(
      `SELECT COUNT(*) as count FROM upload_jobs 
       WHERE (strftime('%s', 'now') - strftime('%s', created_at)) <= ? AND user_id = ?`,
      [windowSeconds, userId]
    );
    return Number(row?.count || 0);
  }
}
