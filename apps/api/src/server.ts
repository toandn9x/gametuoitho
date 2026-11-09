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

// 3. Initialize File Storage & Seed sample assets if needed
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Helper to create minimal valid JAR binary
function createMinimalJarBuffer(title: string): Buffer {
  const manifest = Buffer.from(
    `Manifest-Version: 1.0\r\nMIDlet-1: ${title},,com.gametuoitho.Main\r\nMIDlet-Name: ${title}\r\nMIDlet-Vendor: Game Tuoi Tho\r\nMIDlet-Version: 1.0.0\r\nMicroEdition-Configuration: CLDC-1.1\r\nMicroEdition-Profile: MIDP-2.0\r\n`
  );
  const filename = Buffer.from('META-INF/MANIFEST.MF');
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(0, 14);
  localHeader.writeUInt32LE(manifest.length, 18);
  localHeader.writeUInt32LE(manifest.length, 22);
  localHeader.writeUInt16LE(filename.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(0, 14);
  centralHeader.writeUInt32LE(0, 16);
  centralHeader.writeUInt32LE(manifest.length, 20);
  centralHeader.writeUInt32LE(manifest.length, 24);
  centralHeader.writeUInt16LE(filename.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(0, 42);

  const centralDirSize = centralHeader.length + filename.length;
  const centralDirOffset = localHeader.length + filename.length + manifest.length;

  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(1, 8);
  endRecord.writeUInt16LE(1, 10);
  endRecord.writeUInt32LE(centralDirSize, 12);
  endRecord.writeUInt32LE(centralDirOffset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([localHeader, filename, manifest, centralHeader, filename, endRecord]);
}

// Seed sample JARs on disk if missing
const seedAssets = sqlite
  .prepare("SELECT storage_key, original_filename FROM game_assets WHERE asset_type = 'JAR'")
  .all() as { storage_key: string; original_filename: string }[];

for (const asset of seedAssets) {
  const filePath = path.join(UPLOADS_DIR, asset.storage_key);
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, createMinimalJarBuffer(asset.original_filename));
  }
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
--------------------------------------------------------------------
🔑  Admin Login:      admin / Admin@123456
👤  Player Login:     gamer9x / Gamer@123456
====================================================================
`);
  }
);
