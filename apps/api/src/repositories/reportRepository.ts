import { DatabaseClient } from './db';

export interface CrashReport {
  id: string;
  game_id?: string | null;
  game_version_id?: string | null;
  game_slug?: string | null;
  game_name: string;
  user_id?: string | null;
  error_type: 'LOAD_FAILED' | 'CRASH' | 'EMULATOR_ERROR' | 'CORRUPT_JAR' | 'USER_REPORT';
  error_message: string;
  stack_trace?: string | null;
  user_agent?: string | null;
  status: 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'IGNORED';
  admin_notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReportFilter {
  page?: number;
  limit?: number;
  status?: CrashReport['status'];
  errorType?: CrashReport['error_type'];
  gameId?: string;
  search?: string;
}

export class ReportRepository {
  constructor(private db: DatabaseClient) {}

  async createReport(report: CrashReport): Promise<void> {
    const sql = `
      INSERT INTO game_crash_reports (
        id, game_id, game_version_id, game_slug, game_name, user_id,
        error_type, error_message, stack_trace, user_agent, status, admin_notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `;
    await this.db.execute(sql, [
      report.id,
      report.game_id || null,
      report.game_version_id || null,
      report.game_slug || null,
      report.game_name,
      report.user_id || null,
      report.error_type,
      report.error_message,
      report.stack_trace || null,
      report.user_agent || null,
      report.status || 'OPEN',
      report.admin_notes || null,
    ]);
  }

  async findReports(filter: ReportFilter = {}): Promise<{ reports: CrashReport[]; total: number }> {
    const page = Math.max(1, filter.page || 1);
    const limit = Math.min(100, Math.max(1, filter.limit || 20));
    const offset = (page - 1) * limit;

    const whereClauses: string[] = [];
    const params: any[] = [];

    if (filter.status) {
      whereClauses.push('status = ?');
      params.push(filter.status);
    }
    if (filter.errorType) {
      whereClauses.push('error_type = ?');
      params.push(filter.errorType);
    }
    if (filter.gameId) {
      whereClauses.push('game_id = ?');
      params.push(filter.gameId);
    }
    if (filter.search) {
      whereClauses.push('(game_name LIKE ? OR error_message LIKE ? OR game_slug LIKE ?)');
      const term = `%${filter.search}%`;
      params.push(term, term, term);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countRes = await this.db.queryFirst<{ total: number }>(
      `SELECT count(*) as total FROM game_crash_reports ${whereSql}`,
      params
    );
    const total = countRes?.total || 0;

    const selectSql = `
      SELECT * FROM game_crash_reports
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    const reports = await this.db.query<CrashReport>(selectSql, [...params, limit, offset]);

    return { reports, total };
  }

  async findById(id: string): Promise<CrashReport | null> {
    return this.db.queryFirst<CrashReport>(
      'SELECT * FROM game_crash_reports WHERE id = ?',
      [id]
    );
  }

  async updateReport(id: string, updates: Partial<CrashReport>): Promise<void> {
    const fields: string[] = [];
    const params: any[] = [];

    const allowed = ['status', 'admin_notes'];
    for (const key of allowed) {
      if ((updates as any)[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push((updates as any)[key]);
      }
    }

    if (fields.length === 0) return;
    fields.push("updated_at = datetime('now')");
    params.push(id);

    await this.db.execute(
      `UPDATE game_crash_reports SET ${fields.join(', ')} WHERE id = ?`,
      params
    );
  }

  async deleteReport(id: string): Promise<void> {
    await this.db.execute('DELETE FROM game_crash_reports WHERE id = ?', [id]);
  }

  async getStats(): Promise<{
    total: number;
    open: number;
    investigating: number;
    resolved: number;
    ignored: number;
  }> {
    const rows = await this.db.query<{ status: string; count: number }>(
      'SELECT status, count(*) as count FROM game_crash_reports GROUP BY status'
    );
    let total = 0;
    let open = 0;
    let investigating = 0;
    let resolved = 0;
    let ignored = 0;

    for (const r of rows) {
      total += r.count;
      if (r.status === 'OPEN') open = r.count;
      else if (r.status === 'INVESTIGATING') investigating = r.count;
      else if (r.status === 'RESOLVED') resolved = r.count;
      else if (r.status === 'IGNORED') ignored = r.count;
    }

    return { total, open, investigating, resolved, ignored };
  }
}
