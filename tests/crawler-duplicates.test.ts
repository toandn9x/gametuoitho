/**
 * Crawler duplicate guard: same catalog entry (source_key, also for games imported before migration 0007),
 * same JAR file (SHA-256), same name as a catalog game, concurrent imports, and the "already imported"
 * flags in the crawler list (no 100-game limit). gametuoitho.cc is replaced by a fetch stub.
 * Run: pnpm --filter @gametuoitho/api test   (or: tsx tests/crawler-duplicates.test.ts)
 */
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'node:zlib';
import Database from 'better-sqlite3';
import { createApp } from '../apps/api/src/index';
import { SqliteDatabaseClient } from '../apps/api/src/repositories/db';
import { LocalStorageDriver } from '../apps/api/src/storage/storage';
import { runMigrations } from '../apps/api/src/repositories/migrationRunner';

// --- minimal JAR (stored ZIP with a manifest) ---
function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
function makeJar(manifestText: string): Uint8Array {
  const name = Buffer.from('META-INF/MANIFEST.MF');
  const data = Buffer.from(manifestText);
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(10, 4); local.writeUInt16LE(0, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(10, 6);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  const localPart = Buffer.concat([local, name, data]);
  const centralPart = Buffer.concat([central, name]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralPart.length, 12); end.writeUInt32LE(localPart.length, 16);
  return new Uint8Array(Buffer.concat([localPart, centralPart, end]));
}
void zlib;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(16).fill(1)]);

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`   ✓ ${name}`);
}

async function main() {
  console.log('Crawler duplicate-guard tests...');
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-crawldup-'));
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = new SqliteDatabaseClient(sqlite);
  runMigrations(db, path.resolve(__dirname, '../database/migrations'));
  sqlite.exec(fs.readFileSync(path.resolve(__dirname, '../database/seeds/0001_seed_data.sql'), 'utf-8'));
  const app = createApp(db, new LocalStorageDriver(path.join(workDir, 'uploads')));
  const env = { JWT_SECRET: 'crawler-dup-test-secret-0123456789abcdefghijklmn', ENVIRONMENT: 'production', DB: null, BUCKET: null, _dbClient: db };
  const call = async (method: string, url: string, body?: unknown, token?: string) => {
    const res = await app.fetch(
      new Request(`http://localhost${url}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env
    );
    return { status: res.status, json: (await res.json()) as any };
  };

  // Admin account.
  await call('POST', '/api/v1/auth/register', { username: 'crawladmin', email: 'crawladmin@example.test', password: 'Strong-pass-123' });
  sqlite.prepare("UPDATE users SET role = 'ADMIN' WHERE username = 'crawladmin'").run();
  const token = (await call('POST', '/api/v1/auth/login', { usernameOrEmail: 'crawladmin', password: 'Strong-pass-123' })).json.data.token;

  // gametuoitho.cc stub: each JAR URL gets its own bytes unless pinned to another URL's bytes.
  const originalFetch = globalThis.fetch;
  const jarDownloads: string[] = [];
  const sameBytesAs = new Map<string, string>();
  // Cover URL substring → fake response (e.g. the HTML page gametuoitho.cc serves for a missing icon).
  const coverOverride = new Map<string, () => Response>();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.startsWith('https://gametuoitho.cc/')) return originalFetch(input as any);
    if (/\.jar$/i.test(decodeURI(url))) {
      jarDownloads.push(url);
      const seed = sameBytesAs.get(url) ?? url;
      return new Response(makeJar(`Manifest-Version: 1.0\r\nMIDlet-Name: Test\r\nMIDlet-1: Test,,Main\r\nSeed: ${seed}\r\n`), { status: 200 });
    }
    for (const [needle, respond] of coverOverride) if (url.includes(needle)) return respond();
    return new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } });
  }) as typeof fetch;

  const gameCount = () => (sqlite.prepare('SELECT COUNT(*) AS n FROM games').get() as any).n as number;
  const search = async (q: string) => (await call('GET', `/api/v1/admin/crawler/games?search=${encodeURIComponent(q)}&limit=50`, undefined, token)).json.data as any[];
  const jarUrl = (g: any) => `https://gametuoitho.cc/games/${encodeURI(g.filename.replace(/^\/+/, ''))}`;

  try {
    const bounce = (await search('Bounce Tales')).filter((g) => g.name === 'Bounce Tales');
    assert.ok(bounce.length >= 2, 'catalog has at least two entries named "Bounce Tales"');
    const [entryA, entryB] = bounce;
    const otherEntries = (await search('Diamond Rush')).filter((g) => g.name === 'Diamond Rush');
    const entryC = otherEntries[0];

    let slugA = '';
    await test('first import of an entry → 200, source_key stored', async () => {
      const res = await call('POST', '/api/v1/admin/crawler/import', { gameId: entryA.source_key }, token);
      assert.equal(res.status, 200, JSON.stringify(res.json));
      slugA = res.json.data.game.slug;
      const row = sqlite.prepare('SELECT source_key FROM games WHERE id = ?').get(res.json.data.game.id) as any;
      assert.equal(row.source_key, entryA.source_key);
    });

    await test('list marks the imported entry; a same-name entry gets a warning, not "imported"', async () => {
      const list = await search('Bounce Tales');
      const a = list.find((g) => g.source_key === entryA.source_key);
      const b = list.find((g) => g.source_key === entryB.source_key);
      assert.equal(a.is_imported, true);
      assert.equal(a.imported_slug, slugA);
      assert.equal(b.is_imported, false);
      assert.equal(b.same_name_slug, slugA);
    });

    await test('same entry again → 409 ALREADY_IMPORTED, nothing downloaded or created', async () => {
      const before = gameCount();
      jarDownloads.length = 0;
      const res = await call('POST', '/api/v1/admin/crawler/import', { gameId: entryA.source_key }, token);
      assert.equal(res.status, 409);
      assert.equal(res.json.error.code, 'CONFLICT');
      assert.equal(res.json.error.reason, 'ALREADY_IMPORTED');
      assert.equal(res.json.error.slug, slugA);
      assert.equal(jarDownloads.length, 0, 'no download for a known entry');
      assert.equal(gameCount(), before);
      // also when addressed by catalog id instead of source_key
      const byId = await call('POST', '/api/v1/admin/crawler/import', { gameId: entryA.id }, token);
      assert.ok([409].includes(byId.status));
    });

    await test('different entry with the same name → 409 SAME_NAME by default, no download', async () => {
      const before = gameCount();
      jarDownloads.length = 0;
      const res = await call('POST', '/api/v1/admin/crawler/import', { gameId: entryB.source_key }, token);
      assert.equal(res.status, 409);
      assert.equal(res.json.error.reason, 'SAME_NAME');
      assert.equal(jarDownloads.length, 0);
      assert.equal(gameCount(), before);
    });

    await test('same-name entry with allowSameName → imported as a separate game', async () => {
      const res = await call('POST', '/api/v1/admin/crawler/import', { gameId: entryB.source_key, allowSameName: true }, token);
      assert.equal(res.status, 200, JSON.stringify(res.json));
      assert.notEqual(res.json.data.game.slug, slugA);
      const again = await call('POST', '/api/v1/admin/crawler/import', { gameId: entryB.source_key, allowSameName: true }, token);
      assert.equal(again.json.error.reason, 'ALREADY_IMPORTED');
    });

    await test('other entry whose JAR is byte-identical → 409 SAME_FILE', async () => {
      sameBytesAs.set(jarUrl(entryC), jarUrl(entryA));
      const before = gameCount();
      const res = await call('POST', '/api/v1/admin/crawler/import', { gameId: entryC.source_key }, token);
      assert.equal(res.status, 409);
      assert.equal(res.json.error.reason, 'SAME_FILE');
      assert.equal(gameCount(), before);
      sameBytesAs.clear();
    });

    await test('games imported before migration 0007 (no source_key) are still recognised', async () => {
      sqlite.prepare('UPDATE games SET source_key = NULL WHERE slug = ?').run(slugA);
      const a = (await search('Bounce Tales')).find((g) => g.source_key === entryA.source_key);
      assert.equal(a.is_imported, true);
      const res = await call('POST', '/api/v1/admin/crawler/import', { gameId: entryA.source_key }, token);
      assert.equal(res.json.error.reason, 'ALREADY_IMPORTED');
    });

    await test('"imported" flags are exact with more than 100 games in the catalog', async () => {
      const insert = sqlite.prepare(
        "INSERT INTO games (id, name, slug, category_id, status, visibility, source_type, created_at, updated_at) VALUES (?, ?, ?, 'cat-rpg', 'DRAFT', 'PUBLIC', 'ADMIN', datetime('now'), datetime('now'))"
      );
      for (let i = 0; i < 130; i++) insert.run(`filler-${i}`, `Filler Game ${i}`, `filler-game-${i}`);
      const a = (await search('Bounce Tales')).find((g) => g.source_key === entryA.source_key);
      assert.equal(a.is_imported, true);
    });

    await test('batch: new → imported, known → skipped (not errors), same name → skipped', async () => {
      const fresh = (await search('Diamond Rush')).find((g) => g.name === 'Diamond Rush');
      const before = gameCount();
      const res = await call('POST', '/api/v1/admin/crawler/batch-import', { gameIds: [fresh.source_key, entryA.source_key, entryB.source_key] }, token);
      assert.equal(res.status, 200);
      assert.equal(res.json.data.importedCount, 1);
      assert.equal(res.json.data.skippedCount, 2);
      assert.equal(res.json.data.errorCount, 0);
      assert.deepEqual(res.json.data.results.map((r: any) => r.reason ?? 'ok'), ['ok', 'ALREADY_IMPORTED', 'ALREADY_IMPORTED']);
      assert.equal(gameCount(), before + 1);
    });

    await test('two concurrent imports of the same new entry → exactly one game', async () => {
      const entry = (await search('Worms')).find((g) => !g.is_imported && !g.same_name_slug);
      assert.ok(entry, 'a fresh "Worms" entry');
      const before = gameCount();
      const results = await Promise.all([
        call('POST', '/api/v1/admin/crawler/import', { gameId: entry.source_key }, token),
        call('POST', '/api/v1/admin/crawler/import', { gameId: entry.source_key }, token),
      ]);
      assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.status)));
      assert.equal(results.filter((r) => r.status === 409).length, 1);
      assert.equal(gameCount(), before + 1);
      const orphanAssets = (sqlite.prepare("SELECT COUNT(*) AS n FROM game_assets a WHERE a.asset_type = 'JAR' AND NOT EXISTS (SELECT 1 FROM game_versions v WHERE v.jar_asset_id = a.id)").get() as any).n;
      assert.equal(orphanAssets, 0, 'the losing import is rolled back completely');
    });

    // --- covers: optional, never stored unless they are real images ---
    const coverCases: [string, string, () => Response][] = [
      ['HTML page instead of an image (missing icon on gametuoitho.cc)', 'Robinson Crusoe', () => new Response('<!doctype html><html><body>app</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } })],
      ['icon answers 404', 'Assassin', () => new Response('nope', { status: 404 })],
      ['SVG placeholder', 'Contra', () => new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { status: 200, headers: { 'Content-Type': 'image/svg+xml' } })],
    ];
    for (const [label, query, respond] of coverCases) {
      await test(`cover ${label} → game imported without cover, with a warning`, async () => {
        const entry = (await search(query)).find((g) => !g.is_imported && !g.same_name_slug);
        assert.ok(entry, `a fresh "${query}" entry`);
        coverOverride.set(entry.icon, respond);
        const coversBefore = (sqlite.prepare("SELECT COUNT(*) AS n FROM game_assets WHERE asset_type = 'COVER'").get() as any).n;
        const res = await call('POST', '/api/v1/admin/crawler/import', { gameId: entry.source_key }, token);
        coverOverride.clear();
        assert.equal(res.status, 200, JSON.stringify(res.json));
        assert.equal(res.json.data.game.cover_asset_id, null);
        assert.equal(res.json.data.warnings.length, 1);
        assert.match(res.json.data.warnings[0], /ảnh bìa/);
        assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM game_assets WHERE asset_type = 'COVER'").get() as any).n, coversBefore, 'no cover asset stored');
      });
    }

    await test('valid cover → stored, no warning', async () => {
      const entry = (await search('Bobby Carrot')).find((g) => !g.is_imported && !g.same_name_slug);
      assert.ok(entry);
      const res = await call('POST', '/api/v1/admin/crawler/import', { gameId: entry.source_key }, token);
      assert.equal(res.status, 200, JSON.stringify(res.json));
      assert.ok(res.json.data.game.cover_asset_id);
      assert.deepEqual(res.json.data.warnings, []);
    });

    await test('batch reports cover warnings per game', async () => {
      const entry = (await search('Kungfu Panda')).find((g) => !g.is_imported && !g.same_name_slug)
        || (await search('Kung Fu Panda')).find((g) => !g.is_imported && !g.same_name_slug);
      assert.ok(entry);
      coverOverride.set(entry.icon, () => new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
      const res = await call('POST', '/api/v1/admin/crawler/batch-import', { gameIds: [entry.source_key] }, token);
      coverOverride.clear();
      assert.equal(res.json.data.importedCount, 1);
      assert.equal(res.json.data.results[0].warnings.length, 1);
    });

    await test('catalog: icons of the source site\'s featured games point at real files', async () => {
      const catalog = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../database/gametuoitho_cc_catalog.json'), 'utf8'));
      const icon = (id: string) => catalog.find((g: any) => g.id === id)?.icon;
      assert.equal(icon('NinjaSchool2'), '/icon-game/ninja-school-2.png');
      assert.equal(icon('NinjaSchool3'), '/icon-game/ninja-school-3.png');
      assert.equal(icon('NinjaSchool3-nohack'), '/icon-game/ninja-school-3.png');
      assert.equal(icon('DiamondRush'), '/icon-game/diamond-rush.png');
      assert.ok(icon('AssassinCreed3') && !icon('AssassinCreed3').includes('/category/'));
      assert.ok(icon('RobinsonCrusoeShipwrecked') && !icon('RobinsonCrusoeShipwrecked').includes('/category/'));
    });
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  console.log(`Crawler duplicate guard: ${passed} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
