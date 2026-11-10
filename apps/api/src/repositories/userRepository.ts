import { DatabaseClient } from './db';
import { AdminUser, User } from '@gametuoitho/shared-types';
import { AdminUserQueryInput } from '@gametuoitho/api-contracts';

const ADMIN_USER_COLUMNS = 'id, username, email, role, status, created_at, updated_at';

export class UserRepository {
  constructor(private db: DatabaseClient) {}

  async findById(id: string): Promise<User | null> {
    return this.db.queryFirst<User>('SELECT * FROM users WHERE id = ?', [id]);
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.db.queryFirst<User>('SELECT * FROM users WHERE username = ?', [username]);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.db.queryFirst<User>('SELECT * FROM users WHERE email = ?', [email]);
  }

  async findByUsernameOrEmail(identifier: string): Promise<User | null> {
    return this.db.queryFirst<User>(
      'SELECT * FROM users WHERE username = ? OR email = ?',
      [identifier, identifier]
    );
  }

  async create(user: {
    id: string;
    username: string;
    email: string;
    password_hash: string;
    role?: 'USER' | 'ADMIN';
  }): Promise<void> {
    await this.db.execute(
      `INSERT INTO users (id, username, email, password_hash, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))`,
      [user.id, user.username, user.email, user.password_hash, user.role || 'USER']
    );
  }

  async incrementTokenVersion(id: string): Promise<void> {
    await this.db.execute(
      `UPDATE users SET token_version = COALESCE(token_version, 0) + 1, updated_at = datetime('now') WHERE id = ?`,
      [id]
    );
  }

  async updateRoleOrStatus(id: string, updates: { role?: 'USER' | 'ADMIN'; status?: 'ACTIVE' | 'BLOCKED' }): Promise<void> {
    const sets: string[] = ['updated_at = datetime(\'now\')', 'token_version = COALESCE(token_version, 0) + 1'];
    const params: any[] = [];
    if (updates.role) {
      sets.push('role = ?');
      params.push(updates.role);
    }
    if (updates.status) {
      sets.push('status = ?');
      params.push(updates.status);
    }
    params.push(id);
    await this.db.execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async count(): Promise<number> {
    const res = await this.db.queryFirst<{ count: number }>('SELECT count(*) as count FROM users');
    return res?.count || 0;
  }

  async findForAdmin(query: AdminUserQueryInput): Promise<{ users: AdminUser[]; total: number }> {
    const conditions: string[] = [];
    const params: string[] = [];
    if (query.search) {
      // Treat %, _ and backslash as literal search text.
      const search = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`;
      conditions.push("(username LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')");
      params.push(search, search);
    }
    if (query.role) {
      conditions.push('role = ?');
      params.push(query.role);
    }
    if (query.status) {
      conditions.push('status = ?');
      params.push(query.status);
    }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const count = await this.db.queryFirst<{ total: number }>(`SELECT COUNT(*) AS total FROM users${where}`, params);
    const users = await this.db.query<AdminUser>(
      `SELECT ${ADMIN_USER_COLUMNS} FROM users${where} ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?`,
      [...params, query.limit, (query.page - 1) * query.limit]
    );
    return { users, total: count?.total ?? 0 };
  }

  async findAccountForAdmin(id: string): Promise<AdminUser | null> {
    return this.db.queryFirst<AdminUser>(`SELECT ${ADMIN_USER_COLUMNS} FROM users WHERE id = ?`, [id]);
  }

  async updateMemberStatus(id: string, status: User['status']): Promise<boolean> {
    const result = await this.db.execute(
      `UPDATE users SET status = ?, token_version = COALESCE(token_version, 0) + 1,
       updated_at = datetime('now') WHERE id = ? AND role = 'USER' AND status <> ?`,
      [status, id, status]
    );
    return result.rowsAffected > 0;
  }

  // --- Sign in with Google (migration 0006) ---

  async findByGoogleSub(googleSub: string): Promise<User | null> {
    return this.db.queryFirst<User>('SELECT * FROM users WHERE google_sub = ?', [googleSub]);
  }

  async createGoogleUser(user: {
    id: string;
    username: string;
    email: string;
    password_hash: string;
    google_sub: string;
  }): Promise<void> {
    await this.db.execute(
      `INSERT INTO users (id, username, email, password_hash, role, status, google_sub, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'USER', 'ACTIVE', ?, datetime('now'), datetime('now'))`,
      [user.id, user.username, user.email, user.password_hash, user.google_sub]
    );
  }
}
