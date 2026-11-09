import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { createApp } from './index';
import { SqliteDatabaseClient } from './repositories/db';
import { LocalStorageDriver } from './storage/storage';

// 1. Locate repository root safely
function findProjectRoot(): string {
  let curr = path.resolve(process.cwd());
  while (curr !== path.dirname(curr)) {
    if (
      fs.existsSync(path.join(curr, 'pnpm-workspace.yaml')) ||
      (fs.existsSync(path.join(curr, 'database')) && fs.existsSync(path.join(curr, 'apps')))
    ) {
      return curr;
    }
    curr = path.dirname(curr);
  }
  return process.cwd();
}

const ROOT_DIR = findProjectRoot();
const DB_PATH = process.env.DB_PATH || path.join(ROOT_DIR, 'gametuoitho.sqlite');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(ROOT_DIR, 'uploads');
const WEB_DIST_DIR = process.env.WEB_DIST || path.join(ROOT_DIR, 'apps/web/dist');
const MIGRATIONS_FILE = path.join(ROOT_DIR, 'database/migrations/0001_initial_schema.sql');
const SEED_FILE = path.join(ROOT_DIR, 'database/seeds/0001_seed_data.sql');

const PORT = Number(process.env.PORT || 4321);
const HOST = process.env.HOST || '0.0.0.0';

// 2. Initialize SQLite Database
console.log(`[UnifiedServer] Connecting to SQLite at: ${DB_PATH}`);
const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// Automatically run migrations & seeds if fresh database
const tableCheck = sqlite
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='games'")
  .get();

if (!tableCheck) {
  console.log('[UnifiedServer] Initializing fresh database schema...');
  if (fs.existsSync(MIGRATIONS_FILE)) {
    const migrationSql = fs.readFileSync(MIGRATIONS_FILE, 'utf-8');
    sqlite.exec(migrationSql);
    console.log('[UnifiedServer] ✓ Applied schema migrations');
  }

  if (fs.existsSync(SEED_FILE)) {
    const seedSql = fs.readFileSync(SEED_FILE, 'utf-8');
    sqlite.exec(seedSql);
    console.log('[UnifiedServer] ✓ Applied initial seed data');
  }
}

// 3. Initialize File Storage
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const dbClient = new SqliteDatabaseClient(sqlite);
const storageDriver = new LocalStorageDriver(UPLOADS_DIR, '/api/v1/assets/raw/');

// 4. Create App and Attach Static Handlers
const app = createApp(dbClient, storageDriver);

// Static Web Frontend Serving
if (fs.existsSync(WEB_DIST_DIR)) {
  console.log(`[UnifiedServer] Serving Web Frontend from: ${WEB_DIST_DIR}`);
  app.use('/*', serveStatic({ root: WEB_DIST_DIR }));

  // Fallback for HTML routing / SPA
  app.get('*', async (c, next) => {
    if (c.req.path.startsWith('/api/') || c.req.path === '/health') {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'API route not found' } },
        404
      );
    }
    const indexPath = path.join(WEB_DIST_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      return c.html(fs.readFileSync(indexPath, 'utf-8'));
    }
    return next();
  });
} else {
  console.warn(
    `[UnifiedServer] Warning: Web dist directory not found at ${WEB_DIST_DIR}. Run 'pnpm --filter @gametuoitho/web build' to compile frontend.`
  );
}

// 5. Start Single Server
serve(
  {
    fetch: (req) => {
      const env = {
        JWT_SECRET: process.env.JWT_SECRET || 'gametuoitho-production-secret-key',
        ENVIRONMENT: process.env.NODE_ENV || 'production',
        DB: null,
        BUCKET: null,
        _dbClient: dbClient,
        _storageDriver: storageDriver,
      };
      return app.fetch(req, env);
    },
    port: PORT,
    hostname: HOST,
  },
  (info) => {
    console.log(`
====================================================================
🎮  GAME TUỔI THƠ --- UNIFIED SERVER (SINGLE PROCESS NODE.JS)
====================================================================
🚀  Web & API Server: http://localhost:${info.port}
📑  API Root:         http://localhost:${info.port}/api/v1
🕹️   Web Frontend:     http://localhost:${info.port}
📁  SQLite Database:  ${DB_PATH}
💾  Uploads Storage:  ${UPLOADS_DIR}
====================================================================
`);
  }
);
