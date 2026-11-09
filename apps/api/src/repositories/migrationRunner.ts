import * as fs from 'fs';
import * as path from 'path';

export interface MigrationSqlite {
  prepare(sql: string): {
    get(...params: any[]): any;
    all(...params: any[]): any[];
    run(...params: any[]): any;
  };
  exec(sql: string): any;
}

/**
 * Migration runner applying all database/migrations/*.sql in order,
 * tracking applied migrations in schema_migrations table.
 * Correctly detects pre-existing tables from 0001, 0002, 0003 so existing databases are not re-applied.
 */
export function runMigrations(sqliteOrClient: MigrationSqlite | any, migrationsDir: string): string[] {
  const sqlite: MigrationSqlite =
    typeof sqliteOrClient?.exec === 'function'
      ? sqliteOrClient
      : sqliteOrClient?.db;

  if (!sqlite || typeof sqlite.exec !== 'function') {
    throw new Error('runMigrations requires a better-sqlite3 database instance or SqliteDatabaseClient');
  }
  // 1. Ensure schema_migrations table exists
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // 2. Recognize pre-existing tables to avoid re-applying 0001 / 0002 / 0003
  // Check if games table exists (from 0001)
  const hasGames = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='games'").get();
  if (hasGames) {
    sqlite.prepare("INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0001_initial_schema.sql')").run();
  }

  // Check if game_crash_reports table exists (from 0002)
  const hasCrashReports = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='game_crash_reports'").get();
  if (hasCrashReports) {
    sqlite.prepare("INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0002_crash_reports.sql')").run();
  }

  // Check if token_version column exists in users table (from 0003)
  try {
    const userCols = sqlite.prepare("PRAGMA table_info(users)").all();
    if (userCols && userCols.some((col: any) => col.name === 'token_version')) {
      sqlite.prepare("INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0003_token_version.sql')").run();
    }
  } catch {}

  // Check if uq_user_import_asset index exists (from 0004)
  try {
    const hasImportIndex = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='uq_user_import_asset'").get();
    if (hasImportIndex) {
      sqlite.prepare("INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0004_library_constraints.sql')").run();
    }
  } catch {}

  // 3. Scan migrations directory and apply pending migrations in alphabetical order
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied: string[] = [];

  for (const file of files) {
    const isApplied = sqlite.prepare('SELECT name FROM schema_migrations WHERE name = ?').get(file);
    if (!isApplied) {
      const fullPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(fullPath, 'utf-8');
      sqlite.exec(sql);
      sqlite.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
      applied.push(file);
      console.log(`[MigrationRunner] ✓ Applied migration: ${file}`);
    }
  }

  return applied;
}
