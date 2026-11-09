export interface DatabaseClient {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  queryFirst<T = any>(sql: string, params?: any[]): Promise<T | null>;
  execute(sql: string, params?: any[]): Promise<{ success: boolean; rowsAffected: number }>;
}

// Cloudflare D1 implementation
export class D1DatabaseClient implements DatabaseClient {
  constructor(private d1: any) {}

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const stmt = this.d1.prepare(sql).bind(...params);
    const { results } = await stmt.all();
    return (results as T[]) || [];
  }

  async queryFirst<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const stmt = this.d1.prepare(sql).bind(...params);
    const result = await stmt.first();
    return (result as T) || null;
  }

  async execute(sql: string, params: any[] = []): Promise<{ success: boolean; rowsAffected: number }> {
    const stmt = this.d1.prepare(sql).bind(...params);
    const res = await stmt.run();
    return {
      success: res.success ?? true,
      rowsAffected: res.meta?.changes ?? 0,
    };
  }
}

// Local SQLite implementation (using better-sqlite3)
export class SqliteDatabaseClient implements DatabaseClient {
  constructor(private db: any) {}

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  async queryFirst<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const stmt = this.db.prepare(sql);
    const result = stmt.get(...params);
    return (result as T) ?? null;
  }

  async execute(sql: string, params: any[] = []): Promise<{ success: boolean; rowsAffected: number }> {
    const stmt = this.db.prepare(sql);
    const res = stmt.run(...params);
    return {
      success: true,
      rowsAffected: res.changes,
    };
  }
}
