import { DatabaseClient } from './db';
import { generateId } from '@gametuoitho/shared-utils';

export interface AuditLogEntry {
  userId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  details?: any;
  ipAddress?: string | null;
}

export class AuditRepository {
  constructor(private db: DatabaseClient) {}

  async log(params: AuditLogEntry): Promise<void> {
    try {
      const id = generateId();
      const detailsStr = params.details ? JSON.stringify(params.details) : null;
      await this.db.execute(
        `INSERT INTO audit_logs (id, user_id, action, target_type, target_id, details, ip_address, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          id,
          params.userId,
          params.action,
          params.targetType,
          params.targetId || null,
          detailsStr,
          params.ipAddress || null,
        ]
      );
    } catch (err) {
      console.warn('[AuditRepository] Log failed:', err);
    }
  }

  async findRecent(limit = 50): Promise<any[]> {
    return this.db.query(
      'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
  }
}
