import { serve } from '@hono/node-server';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { createApp } from './index';
import { SqliteDatabaseClient } from './repositories/db';
import { LocalStorageDriver } from './storage/storage';

const DB_PATH = path.resolve(process.cwd(), 'gametuoitho_dev.sqlite');
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
const MIGRATIONS_FILE = path.resolve(process.cwd(), '../../database/migrations/0001_initial_schema.sql');
const SEED_FILE = path.resolve(process.cwd(), '../../database/seeds/0001_seed_data.sql');

console.log('[DevServer] Initializing Local SQLite Database at:', DB_PATH);
const sqlite = new Database(DB_PATH);

// Run migrations and seeds if not already executed
if (fs.existsSync(MIGRATIONS_FILE)) {
  const migrationSql = fs.readFileSync(MIGRATIONS_FILE, 'utf-8');
  sqlite.exec(migrationSql);
  console.log('[DevServer] Applied Schema Migrations successfully');
}

if (fs.existsSync(SEED_FILE)) {
  const seedSql = fs.readFileSync(SEED_FILE, 'utf-8');
  sqlite.exec(seedSql);
  console.log('[DevServer] Applied Initial Seed Data successfully');
}

const dbClient = new SqliteDatabaseClient(sqlite);
const storageDriver = new LocalStorageDriver(UPLOADS_DIR, '/api/v1/assets/raw/');

const app = createApp(dbClient, storageDriver);

const PORT = 8787;
console.log(`[DevServer] Starting Hono Backend API on http://localhost:${PORT}`);

serve({
  fetch: (req) => {
    // Inject environment variables
    const env = {
      JWT_SECRET: process.env.JWT_SECRET || 'gametuoitho-dev-secret',
      ENVIRONMENT: 'development',
      DB: null,
      BUCKET: null,
      _dbClient: dbClient,
      _storageDriver: storageDriver,
    };
    return app.fetch(req, env);
  },
  port: PORT,
});
