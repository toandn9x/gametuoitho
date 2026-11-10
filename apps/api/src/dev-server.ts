import { serve } from '@hono/node-server';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { createApp } from './index';
import { SqliteDatabaseClient } from './repositories/db';
import { LocalStorageDriver } from './storage/storage';
import { runMigrations } from './repositories/migrationRunner';
import { bootstrapAdmin } from './utils/bootstrapAdmin';

// Defensive error logging for unexpected process events (R06-fix01)
process.on('unhandledRejection', (reason, promise) => {
  console.error('[DevServer] Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err, origin) => {
  console.error('[DevServer] Uncaught Exception:', err, 'origin:', origin);
});

const DB_PATH = path.resolve(process.cwd(), 'gametuoitho_dev.sqlite');
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
const MIGRATIONS_DIR = path.resolve(process.cwd(), '../../database/migrations');
const SEED_FILE = path.resolve(process.cwd(), '../../database/seeds/0001_seed_data.sql');

console.log('[DevServer] Initializing Local SQLite Database at:', DB_PATH);
const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

const dbClient = new SqliteDatabaseClient(sqlite);

// Run migrations via runner
if (fs.existsSync(MIGRATIONS_DIR)) {
  const applied = runMigrations(dbClient, MIGRATIONS_DIR);
  console.log(`[DevServer] Applied ${applied.length} migrations successfully`);
}

// Ensure seed data is populated if categories empty
try {
  const catCountRow = sqlite.prepare("SELECT count(*) as count FROM categories").get() as any;
  if ((!catCountRow || catCountRow.count === 0) && fs.existsSync(SEED_FILE)) {
    const seedSql = fs.readFileSync(SEED_FILE, 'utf-8');
    sqlite.exec(seedSql);
    console.log('[DevServer] Applied Initial Seed Data successfully');
  }
} catch (e: any) {
  console.warn('[DevServer] Seed check warning:', e.message);
}

// Bootstrap initial admin if environment variables provided and no admin exists (R05F-C)
if (process.env.ADMIN_BOOTSTRAP_USERNAME && process.env.ADMIN_BOOTSTRAP_PASSWORD) {
  bootstrapAdmin(dbClient, {
    username: process.env.ADMIN_BOOTSTRAP_USERNAME,
    email: process.env.ADMIN_BOOTSTRAP_EMAIL || `${process.env.ADMIN_BOOTSTRAP_USERNAME}@gametuoitho.local`,
    password: process.env.ADMIN_BOOTSTRAP_PASSWORD,
  })
    .then((res) => {
      if (res.success) {
        console.log(`[DevServer] ✓ ${res.message}`);
      } else if (res.code !== 'ADMIN_EXISTS') {
        console.warn(`[DevServer] Bootstrap admin notice: ${res.message}`);
      }
    })
    .catch((err) => {
      console.warn('[DevServer] Bootstrap admin error:', err.message);
    });
}

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storageDriver = new LocalStorageDriver(UPLOADS_DIR, '/api/v1/assets/raw/');

const app = createApp(dbClient, storageDriver);

const PORT = 8787;
console.log(`[DevServer] Starting Hono Backend API on http://localhost:${PORT}`);

let devSecret = process.env.JWT_SECRET;
if (!devSecret || devSecret.trim().length === 0) {
  devSecret = crypto.randomUUID() + '-' + crypto.randomUUID() + '-' + crypto.randomUUID();
  console.warn('[DevServer] DEV MODE: Using ephemeral random JWT secret. Set JWT_SECRET in production.');
}

serve({
  fetch: (req) => {
    // Inject environment variables
    const env = {
      JWT_SECRET: devSecret!,
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
