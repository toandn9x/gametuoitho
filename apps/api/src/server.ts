import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
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
  console.error('[UnifiedServer] Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err, origin) => {
  console.error('[UnifiedServer] Uncaught Exception:', err, 'origin:', origin);
});

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

const dbClient = new SqliteDatabaseClient(sqlite);

// Run all migrations through migrationRunner
const migrationsDir = path.join(ROOT_DIR, 'database/migrations');
const appliedMigrations = runMigrations(dbClient, migrationsDir);
console.log(`[UnifiedServer] ✓ Schema migrations up to date (${appliedMigrations.length} applied)`);

// Ensure seed data is populated if categories empty
try {
  const catCountRow = sqlite.prepare("SELECT count(*) as count FROM categories").get() as any;
  if ((!catCountRow || catCountRow.count === 0) && fs.existsSync(SEED_FILE)) {
    const seedSql = fs.readFileSync(SEED_FILE, 'utf-8');
    sqlite.exec(seedSql);
    console.log('[UnifiedServer] ✓ Applied initial seed data');
  }
} catch (e: any) {
  console.warn('[UnifiedServer] Seed check warning:', e.message);
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
        console.log(`[UnifiedServer] ✓ ${res.message}`);
      } else if (res.code !== 'ADMIN_EXISTS') {
        console.warn(`[UnifiedServer] Bootstrap admin notice: ${res.message}`);
      }
    })
    .catch((err) => {
      console.warn('[UnifiedServer] Bootstrap admin error:', err.message);
    });
}

// 3. Initialize File Storage
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storageDriver = new LocalStorageDriver(UPLOADS_DIR, '/api/v1/assets/raw/');

// Security & Secret policy (R05-A)
const isProduction = process.env.NODE_ENV === 'production' || process.env.ENVIRONMENT === 'production';
let jwtSecret = process.env.JWT_SECRET;
if (isProduction) {
  if (!jwtSecret || jwtSecret.trim().length < 32) {
    console.error('[UnifiedServer] FATAL: JWT_SECRET must be set and have at least 32 characters in production.');
    process.exit(1);
  }
} else {
  if (!jwtSecret || jwtSecret.trim().length === 0) {
    jwtSecret = crypto.randomUUID() + '-' + crypto.randomUUID() + '-' + crypto.randomUUID();
    console.warn('[UnifiedServer] DEV MODE: Using ephemeral random JWT secret. Set JWT_SECRET in production.');
  }
}

// 4. Create App and Attach Static Handlers
const app = createApp(dbClient, storageDriver, UPLOADS_DIR);

// Static Web Frontend Serving
if (fs.existsSync(WEB_DIST_DIR)) {
  console.log(`[UnifiedServer] Serving Web Frontend from: ${WEB_DIST_DIR}`);
  app.use('/*', serveStatic({ root: WEB_DIST_DIR }));

  // Fallback for HTML routing / dynamic shell rewrites / genuine 404
  app.get('*', async (c, next) => {
    const reqPath = c.req.path;
    if (reqPath.startsWith('/api/') || reqPath === '/health') {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'API route not found' } },
        404
      );
    }

    // Prevent directory traversal
    const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
    const targetPath = path.join(WEB_DIST_DIR, safePath);

    // 1. Check if direct file exists
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
      return c.html(fs.readFileSync(targetPath, 'utf-8'));
    }

    // 2. Check if directory index.html exists
    const dirIndexPath = path.join(targetPath, 'index.html');
    if (fs.existsSync(dirIndexPath) && fs.statSync(dirIndexPath).isFile()) {
      return c.html(fs.readFileSync(dirIndexPath, 'utf-8'));
    }

    // 3. Check if .html file exists
    const htmlPath = targetPath + '.html';
    if (fs.existsSync(htmlPath) && fs.statSync(htmlPath).isFile()) {
      return c.html(fs.readFileSync(htmlPath, 'utf-8'));
    }

    // 4. Dynamic shell rewrites for unbuilt published items
    if (reqPath.startsWith('/play/')) {
      const playShell = path.join(WEB_DIST_DIR, 'play', '_shell', 'index.html');
      if (fs.existsSync(playShell)) {
        return c.html(fs.readFileSync(playShell, 'utf-8'), 200);
      }
    }

    if (reqPath.startsWith('/game/')) {
      const gameShell = path.join(WEB_DIST_DIR, 'game', '_shell', 'index.html');
      if (fs.existsSync(gameShell)) {
        return c.html(fs.readFileSync(gameShell, 'utf-8'), 200);
      }
    }

    if (reqPath.startsWith('/categories/')) {
      const catShell = path.join(WEB_DIST_DIR, 'categories', '_shell', 'index.html');
      if (fs.existsSync(catShell)) {
        return c.html(fs.readFileSync(catShell, 'utf-8'), 200);
      }
    }

    // 5. Genuine 404 for any other unrecognized routes
    const notFoundPath = path.join(WEB_DIST_DIR, '404.html');
    if (fs.existsSync(notFoundPath)) {
      return c.html(fs.readFileSync(notFoundPath, 'utf-8'), 404);
    }

    return c.html(
      '<!DOCTYPE html><html><head><title>404 Not Found</title></head><body><h1>404 Not Found</h1></body></html>',
      404
    );
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
        JWT_SECRET: jwtSecret!,
        ENVIRONMENT: isProduction ? 'production' : 'development',
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
