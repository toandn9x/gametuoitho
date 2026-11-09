import { DatabaseClient } from './db';
import { User } from '@gametuoitho/shared-types';

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

  async count(): Promise<number> {
    const res = await this.db.queryFirst<{ count: number }>('SELECT count(*) as count FROM users');
    return res?.count || 0;
  }
}
