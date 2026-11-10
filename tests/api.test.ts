import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'node:zlib';
import { createApp } from '../apps/api/src/index';
import { SqliteDatabaseClient } from '../apps/api/src/repositories/db';
import { LocalStorageDriver } from '../apps/api/src/storage/storage';
import { runMigrations } from '../apps/api/src/repositories/migrationRunner';
import { bootstrapAdmin } from '../apps/api/src/utils/bootstrapAdmin';
import { createJwt, validateJarFile } from '../packages/shared-utils/src/index';
import { apiRequest } from '../apps/web/src/lib/api';
import { runAdminUsersTests } from './admin-users.test';

// Defensive test runner tracking for unhandled rejections and exceptions
let unhandledRejectionCount = 0;
let uncaughtExceptionCount = 0;
let lastUnhandledError: unknown = null;

process.on('unhandledRejection', (reason) => {
  unhandledRejectionCount++;
  lastUnhandledError = reason;
  console.error('[TestRunner] FAIL: unhandledRejection detected during test run:', reason);
});

process.on('uncaughtException', (err) => {
  uncaughtExceptionCount++;
  lastUnhandledError = err;
  console.error('[TestRunner] FAIL: uncaughtException detected during test run:', err);
});

export function createDeflateSyntheticJar(options?: {
  manifestContent?: string;
  corruptDeflate?: boolean;
  uncompSizeOverride?: number;
  entries?: { name: string; data?: Buffer | string; compMethod?: number; uncompSize?: number }[];
}): Buffer {
  const manifestText =
    options?.manifestContent ??
    'Manifest-Version: 1.0\r\nMIDlet-Name: DiamondRush\r\nMIDlet-1: DiamondRush,,com.gameloft.DiamondRush\r\n';
  const manifestRaw = Buffer.from(manifestText, 'utf8');
  let compressedData: Buffer;
  if (options?.corruptDeflate) {
    // Deliberately malformed deflate raw stream bytes
    compressedData = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]);
  } else {
    compressedData = zlib.deflateRawSync(manifestRaw);
  }

  const manifestEntry = {
    name: 'META-INF/MANIFEST.MF',
    data: compressedData,
    compMethod: 8, // Deflate
    uncompSize: options?.uncompSizeOverride !== undefined ? options.uncompSizeOverride : manifestRaw.length,
  };

  const allEntries = [
    manifestEntry,
    ...(options?.entries || []).map((e) => {
      const dataBuf = typeof e.data === 'string' ? Buffer.from(e.data, 'utf8') : (e.data || Buffer.from('data'));
      return {
        name: e.name,
        data: dataBuf,
        compMethod: e.compMethod || 0,
        uncompSize: e.uncompSize !== undefined ? e.uncompSize : dataBuf.length,
      };
    }),
  ];

  const localParts: Buffer[] = [];
  const cdParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of allEntries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const dataBuf = entry.data;

    // Local Header (30 bytes)
    const lh = Buffer.alloc(30);
    lh[0] = 0x50; lh[1] = 0x4b; lh[2] = 0x03; lh[3] = 0x04;
    lh.writeUInt16LE(entry.compMethod, 8);
    lh.writeUInt32LE(dataBuf.length, 18);
    lh.writeUInt32LE(entry.uncompSize, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);

    localParts.push(lh, nameBuf, dataBuf);

    // Central Directory Header (46 bytes)
    const cd = Buffer.alloc(46);
    cd[0] = 0x50; cd[1] = 0x4b; cd[2] = 0x01; cd[3] = 0x02;
    cd.writeUInt16LE(entry.compMethod, 10);
    cd.writeUInt32LE(dataBuf.length, 20);
    cd.writeUInt32LE(entry.uncompSize, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt32LE(localOffset, 42);

    cdParts.push(cd, nameBuf);

    localOffset += 30 + nameBuf.length + dataBuf.length;
  }

  const localBuffer = Buffer.concat(localParts);
  const cdBuffer = Buffer.concat(cdParts);

  // EOCD (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd[0] = 0x50; eocd[1] = 0x4b; eocd[2] = 0x05; eocd[3] = 0x06;
  eocd.writeUInt16LE(allEntries.length, 8);
  eocd.writeUInt16LE(allEntries.length, 10);
  eocd.writeUInt32LE(cdBuffer.length, 12);
  eocd.writeUInt32LE(localBuffer.length, 16);

  return Buffer.concat([localBuffer, cdBuffer, eocd]);
}

export function createSyntheticJar(
  manifestContent = 'Manifest-Version: 1.0\r\nMIDlet-Name: DiamondRush\r\nMIDlet-1: DiamondRush,,com.gameloft.DiamondRush\r\n',
  entries?: { name: string; data?: Buffer | string; compMethod?: number; uncompSize?: number }[],
  options?: { totalEntriesOverride?: number; cdSizeOverride?: number; cdOffsetOverride?: number }
): Buffer {
  const allEntries: { name: string; data: Buffer; compMethod: number; uncompSize: number }[] = [
    {
      name: 'META-INF/MANIFEST.MF',
      data: Buffer.from(manifestContent, 'utf8'),
      compMethod: 0,
      uncompSize: Buffer.from(manifestContent, 'utf8').length,
    },
    ...(entries || []).map((e) => {
      const dataBuf = typeof e.data === 'string' ? Buffer.from(e.data, 'utf8') : (e.data || Buffer.from('data'));
      return {
        name: e.name,
        data: dataBuf,
        compMethod: e.compMethod || 0,
        uncompSize: e.uncompSize !== undefined ? e.uncompSize : dataBuf.length,
      };
    }),
  ];

  const localParts: Buffer[] = [];
  const cdParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of allEntries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const dataBuf = entry.data;

    // Local Header (30 bytes)
    const lh = Buffer.alloc(30);
    lh[0] = 0x50; lh[1] = 0x4b; lh[2] = 0x03; lh[3] = 0x04;
    lh.writeUInt16LE(entry.compMethod, 8);
    lh.writeUInt32LE(dataBuf.length, 18);
    lh.writeUInt32LE(entry.uncompSize, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);

    localParts.push(lh, nameBuf, dataBuf);

    // Central Directory Header (46 bytes)
    const cd = Buffer.alloc(46);
    cd[0] = 0x50; cd[1] = 0x4b; cd[2] = 0x01; cd[3] = 0x02;
    cd.writeUInt16LE(entry.compMethod, 10);
    cd.writeUInt32LE(dataBuf.length, 20);
    cd.writeUInt32LE(entry.uncompSize, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt32LE(localOffset, 42);

    cdParts.push(cd, nameBuf);

    localOffset += 30 + nameBuf.length + dataBuf.length;
  }

  const localBuffer = Buffer.concat(localParts);
  const cdBuffer = Buffer.concat(cdParts);

  const totalEntries = options?.totalEntriesOverride !== undefined ? options.totalEntriesOverride : allEntries.length;
  const cdSize = options?.cdSizeOverride !== undefined ? options.cdSizeOverride : cdBuffer.length;
  const cdOffset = options?.cdOffsetOverride !== undefined ? options.cdOffsetOverride : localBuffer.length;

  // EOCD (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd[0] = 0x50; eocd[1] = 0x4b; eocd[2] = 0x05; eocd[3] = 0x06;
  eocd.writeUInt16LE(totalEntries, 8);
  eocd.writeUInt16LE(totalEntries, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);

  return Buffer.concat([localBuffer, cdBuffer, eocd]);
}

async function runTests() {
  console.log('--- Bắt đầu chạy Kiểm Thử Tự Động (API & Database Tests) ---');

  const testDb = new Database(':memory:');
  const dbClient = new SqliteDatabaseClient(testDb);
  const migrationsDir = path.resolve(__dirname, '../database/migrations');
  runMigrations(dbClient, migrationsDir);

  const seedSql = fs.readFileSync(
    path.resolve(__dirname, '../database/seeds/0001_seed_data.sql'),
    'utf-8'
  );
  testDb.exec(seedSql);

  // Self-contained test fixtures for automated test suites (R05-E)
  testDb.exec(`
    INSERT INTO users (id, username, email, password_hash, role, status, token_version, created_at, updated_at)
    VALUES
      ('usr-admin-01', 'admin', 'admin@gametuoitho.vn', 'd235387e13a1a21a05c3867631bb0fa9:5c884feed68a8a5d86f04788dcac236e177adddb49b3f4cf9ea8f7ddd3b8c606', 'ADMIN', 'ACTIVE', 0, datetime('now'), datetime('now')),
      ('usr-player-01', 'gamer9x', 'gamer9x@gametuoitho.vn', 'd235387e13a1a21a05c3867631bb0fa9:f7540cd2d2f00bfa15b15b1d5464f502550d958a2b8e6797269fa6241efbd8ca', 'USER', 'ACTIVE', 0, datetime('now'), datetime('now'));

    INSERT INTO game_assets (id, owner_user_id, asset_type, storage_key, original_filename, mime_type, file_size, sha256, status, created_at)
    VALUES
      ('ast-cov-ninja', 'usr-admin-01', 'COVER', 'games/ninja-school/covers/cover.webp', 'cover_ninja.webp', 'image/webp', 45000, 'sha-cov', 'ACTIVE', datetime('now')),
      ('ast-jar-ninja', 'usr-admin-01', 'JAR', 'games/ninja-school/versions/1.0.0/game.jar', 'NinjaSchool.jar', 'application/java-archive', 354890, 'sha-jar', 'ACTIVE', datetime('now')),
      ('ast-cov-bounce', 'usr-admin-01', 'COVER', 'games/bounce-tales/covers/cover.webp', 'cover_bounce.webp', 'image/webp', 38000, 'sha-cov-bounce', 'ACTIVE', datetime('now')),
      ('ast-jar-bounce', 'usr-admin-01', 'JAR', 'games/bounce-tales/versions/1.0.0/game.jar', 'BounceTales.jar', 'application/java-archive', 298000, 'sha-jar-bounce', 'ACTIVE', datetime('now')),
      ('ast-cov-space', 'usr-admin-01', 'COVER', 'games/space-impact/covers/cover.webp', 'cover_space.webp', 'image/webp', 25000, 'sha-cov-space', 'ACTIVE', datetime('now')),
      ('ast-jar-space', 'usr-admin-01', 'JAR', 'games/space-impact/versions/1.0.0/game.jar', 'SpaceImpact.jar', 'application/java-archive', 154000, 'sha-jar-space', 'ACTIVE', datetime('now'));

    INSERT INTO games (id, name, slug, description, developer, publisher, release_year, category_id, cover_asset_id, status, visibility, source_type, created_by, published_at, created_at, updated_at)
    VALUES
      ('gam-ninja', 'Ninja School 1: Tiêu Diệt Sơn Tặc', 'ninja-school', 'Tựa game nhập vai hành động huyền thoại', 'Teamobi', 'Teamobi', 2008, 'cat-rpg', 'ast-cov-ninja', 'PUBLISHED', 'PUBLIC', 'ADMIN', 'usr-admin-01', datetime('now'), datetime('now'), datetime('now')),
      ('gam-bounce', 'Bounce Tales', 'bounce-tales', 'Game bóng nảy Nokia', 'Nokia', 'Nokia', 2008, 'cat-action', 'ast-cov-bounce', 'PUBLISHED', 'PUBLIC', 'ADMIN', 'usr-admin-01', datetime('now'), datetime('now'), datetime('now')),
      ('gam-space', 'Space Impact', 'space-impact', 'Game bắn phi thuyền', 'Nokia', 'Nokia', 2000, 'cat-arcade', 'ast-cov-space', 'PUBLISHED', 'PUBLIC', 'ADMIN', 'usr-admin-01', datetime('now'), datetime('now'), datetime('now'));

    INSERT INTO game_versions (id, game_id, version_name, jar_asset_id, jad_asset_id, jar_sha256, jad_sha256, file_size, status, created_at)
    VALUES
      ('ver-ninja-100', 'gam-ninja', '1.0.0 (Bản Chuẩn 240x320)', 'ast-jar-ninja', NULL, 'sha-jar', NULL, 354890, 'ACTIVE', datetime('now')),
      ('ver-bounce-100', 'gam-bounce', '1.0.0 (Bản Gốc Nokia)', 'ast-jar-bounce', NULL, 'sha-jar-bounce', NULL, 298000, 'ACTIVE', datetime('now')),
      ('ver-space-100', 'gam-space', '1.0.0 (Monochrome Edition)', 'ast-jar-space', NULL, 'sha-jar-space', NULL, 154000, 'ACTIVE', datetime('now'));
  `);

  const testUploadDir = path.resolve(__dirname, '../uploads_test');
  const storageDriver = new LocalStorageDriver(testUploadDir, '/api/v1/assets/raw/');

  let storageGetCalls = 0;
  const originalGet = storageDriver.get.bind(storageDriver);
  storageDriver.get = async (key: string) => {
    storageGetCalls++;
    return originalGet(key);
  };

  const app = createApp(dbClient, storageDriver);

  const env = {
    JWT_SECRET: 'test-secret-key-123456789012345678901234567890',
    DB: null,
    BUCKET: null,
    _dbClient: dbClient,
    _storageDriver: storageDriver,
  };

  const request = async (path: string, options: RequestInit = {}) => {
    const req = new Request(`http://localhost:8787${path}`, options);
    return app.fetch(req, env);
  };

  try {
    // 1. Health check
  console.log('1. Kiểm tra /health...');
  const healthRes = await request('/health');
  if (healthRes.status !== 200) throw new Error('Health check failed');
  const healthJson = await healthRes.json();
  if (healthJson.status !== 'healthy') throw new Error('Health status invalid');
  console.log('   ✓ Health check PASS');

  // 2. Public games list
  console.log('2. Kiểm tra GET /api/v1/games (Public Games)...');
  const gamesRes = await request('/api/v1/games');
  if (gamesRes.status !== 200) {
    const errText = await gamesRes.text();
    console.error('Games endpoint failed with status:', gamesRes.status, errText);
    throw new Error('Games endpoint failed');
  }
  const gamesJson = await gamesRes.json();
  if (!gamesJson.success || !Array.isArray(gamesJson.data) || gamesJson.data.length < 2) {
    throw new Error('Expected at least 2 seeded games');
  }
  console.log(`   ✓ Trả về ${gamesJson.data.length} games có sẵn trong Catalog`);

  // 3. Game detail by slug
  console.log('3. Kiểm tra GET /api/v1/games/ninja-school (Detail with versions)...');
  const ninjaRes = await request('/api/v1/games/ninja-school');
  if (ninjaRes.status !== 200) throw new Error('Detail endpoint failed');
  const ninjaJson = await ninjaRes.json();
  if (!ninjaJson.success || ninjaJson.data.game.slug !== 'ninja-school') {
    throw new Error('Game detail invalid');
  }
  if (!ninjaJson.data.versions || ninjaJson.data.versions.length === 0) {
    throw new Error('Expected at least 1 version for Ninja School');
  }
  console.log(`   ✓ Game chi tiết: ${ninjaJson.data.game.name}, phiên bản: ${ninjaJson.data.versions[0].version_name}`);

  // 4. Categories
  console.log('4. Kiểm tra GET /api/v1/categories...');
  const catRes = await request('/api/v1/categories');
  const catJson = await catRes.json();
  if (!catJson.success || catJson.data.length < 6) {
    throw new Error('Expected at least 6 categories');
  }
  console.log(`   ✓ Danh mục: ${catJson.data.map((c: any) => c.name).join(', ')}`);

  // 5. Auth: User registration
  console.log('5. Kiểm tra POST /api/v1/auth/register...');
  const regRes = await request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'gamer_moi',
      email: 'moi@gametuoitho.vn',
      password: 'password123',
    }),
  });
  if (regRes.status !== 201) throw new Error(`Registration failed: ${regRes.status}`);
  const regJson = await regRes.json();
  if (!regJson.success || !regJson.data.token) throw new Error('No token returned on register');
  const userToken = regJson.data.token;
  console.log('   ✓ Đăng ký tài khoản mới thành công');

  // 6. Auth: Login with Seed Admin
  console.log('6. Kiểm tra POST /api/v1/auth/login (Admin)...');
  const adminLoginRes = await request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      usernameOrEmail: 'admin',
      password: 'Admin@123456',
    }),
  });
  if (adminLoginRes.status !== 200) throw new Error('Admin login failed');
  const adminLoginJson = await adminLoginRes.json();
  if (!adminLoginJson.success || adminLoginJson.data.user.role !== 'ADMIN') {
    throw new Error('Role must be ADMIN');
  }
  const adminToken = adminLoginJson.data.token;
  console.log('   ✓ Đăng nhập Quản trị viên thành công (Role: ADMIN)');

  // 7. Admin Dashboard Stats
  console.log('7. Kiểm tra GET /api/v1/admin/stats...');
  const statsRes = await request('/api/v1/admin/stats', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (statsRes.status !== 200) throw new Error('Admin stats failed');
  const statsJson = await statsRes.json();
  console.log(`   ✓ Thống kê: ${statsJson.data.totalGames} games, ${statsJson.data.totalUsers} users, dung lượng: ${statsJson.data.storageFormatted}`);

  // 8. Security test: Regular user trying to access Admin endpoint
  console.log('8. Kiểm tra Phân Quyền Bảo Mật (User thường truy cập Admin)...');
  const forbiddenRes = await request('/api/v1/admin/stats', {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  if (forbiddenRes.status !== 403) {
    throw new Error(`Expected 403 Forbidden, got ${forbiddenRes.status}`);
  }
  console.log('   ✓ Chặn truy cập trái phép chính xác (HTTP 403 Forbidden)');

  console.log('8b. Kiểm tra quản lý tài khoản độc lập với game tải lên...');
  await runAdminUsersTests(request, dbClient, adminToken, userToken);
  console.log('   ✓ Tìm kiếm, bộ lọc, phân trang, quyền admin, khóa/mở khóa, thu hồi phiên và audit PASS');

  // 9. User Library: Add Catalog Game to Library
  console.log('9. Kiểm tra POST /api/v1/me/library (Thêm game vào thư viện cá nhân)...');
  const addLibRes = await request('/api/v1/me/library', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      game_id: 'gam-bounce',
    }),
  });
  if (addLibRes.status !== 201) throw new Error('Add to library failed');
  console.log('   ✓ Thêm Bounce Tales vào thư viện riêng thành công');

  // 10. Record Activity / Play History
  console.log('10. Kiểm tra POST /api/v1/me/history (Ghi nhận lịch sử chơi)...');
  const histRes = await request('/api/v1/me/history', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      game_id: 'gam-bounce',
      activity_type: 'PLAY',
    }),
  });
  if (histRes.status !== 200) throw new Error('Record history failed');
  console.log('   ✓ Ghi nhận lượt chơi thành công');

  // 11. Storage Driver Traversal & Path Security
  console.log('11. Kiểm tra An Toàn Bộ Nhớ Đệm / Storage Driver (Path Traversal)...');
  const badKey1 = '../../etc/passwd';
  const badRes1 = await storageDriver.get(badKey1);
  if (badRes1 !== null) throw new Error('Expected traversal key to return null');

  const badKey2 = '..\\..\\windows\\win.ini';
  const badRes2 = await storageDriver.get(badKey2);
  if (badRes2 !== null) throw new Error('Expected backslash traversal key to return null');

  const badKey3 = '/absolute/path/file.txt';
  const badRes3 = await storageDriver.get(badKey3);
  if (badRes3 !== null) throw new Error('Expected absolute path key to return null');

  let putThrew = false;
  try {
    await storageDriver.put('../../bad', new Uint8Array([1, 2, 3]), 'application/octet-stream');
  } catch {
    putThrew = true;
  }
  if (!putThrew) throw new Error('Expected put with traversal to throw error');
  console.log('   ✓ Storage Driver chặn Path Traversal chính xác');

  // 12. Public Versions Guard (S2)
  console.log('12. Kiểm tra Public Versions & Game Detail Guard (S2)...');
  testDb.exec(`
    INSERT INTO games (id, name, slug, description, category_id, status, visibility, source_type, created_at, updated_at)
    VALUES
      ('gam-draft-test', 'Draft Game', 'draft-game', 'Draft Desc', 'cat-rpg', 'DRAFT', 'PUBLIC', 'ADMIN', datetime('now'), datetime('now')),
      ('gam-hidden-test', 'Hidden Game', 'hidden-game', 'Hidden Desc', 'cat-rpg', 'HIDDEN', 'PUBLIC', 'ADMIN', datetime('now'), datetime('now')),
      ('gam-archived-test', 'Archived Game', 'archived-game', 'Archived Desc', 'cat-rpg', 'ARCHIVED', 'PUBLIC', 'ADMIN', datetime('now'), datetime('now')),
      ('gam-private-test', 'Private Game', 'private-game', 'Private Desc', 'cat-rpg', 'PUBLISHED', 'PRIVATE', 'ADMIN', datetime('now'), datetime('now'));

    INSERT INTO game_versions (id, game_id, version_name, jar_asset_id, jar_sha256, file_size, status, created_at)
    VALUES
      ('ver-draft-01', 'gam-draft-test', '1.0.0', 'ast-jar-ninja', 'sha', 100, 'ACTIVE', datetime('now')),
      ('ver-hidden-01', 'gam-hidden-test', '1.0.0', 'ast-jar-ninja', 'sha', 100, 'ACTIVE', datetime('now')),
      ('ver-arch-01', 'gam-archived-test', '1.0.0', 'ast-jar-ninja', 'sha', 100, 'ACTIVE', datetime('now')),
      ('ver-priv-01', 'gam-private-test', '1.0.0', 'ast-jar-ninja', 'sha', 100, 'ACTIVE', datetime('now'));
  `);

  // DRAFT game versions -> 404
  const draftVerRes = await request('/api/v1/games/gam-draft-test/versions');
  if (draftVerRes.status !== 404) throw new Error(`Expected 404 for DRAFT game versions, got ${draftVerRes.status}`);

  // HIDDEN game versions -> 404
  const hiddenVerRes = await request('/api/v1/games/gam-hidden-test/versions');
  if (hiddenVerRes.status !== 404) throw new Error(`Expected 404 for HIDDEN game versions, got ${hiddenVerRes.status}`);

  // ARCHIVED game versions -> 404
  const archVerRes = await request('/api/v1/games/gam-archived-test/versions');
  if (archVerRes.status !== 404) throw new Error(`Expected 404 for ARCHIVED game versions, got ${archVerRes.status}`);

  // PRIVATE game versions -> 404
  const privVerRes = await request('/api/v1/games/gam-private-test/versions');
  if (privVerRes.status !== 404) throw new Error(`Expected 404 for PRIVATE game versions, got ${privVerRes.status}`);

  // Non-existent game versions -> 404
  const nonExistentVerRes = await request('/api/v1/games/non-existent-game-id/versions');
  if (nonExistentVerRes.status !== 404) throw new Error(`Expected 404 for non-existent game, got ${nonExistentVerRes.status}`);

  // Valid PUBLISHED + PUBLIC game versions -> 200
  const pubVerRes = await request('/api/v1/games/gam-bounce/versions');
  if (pubVerRes.status !== 200) throw new Error(`Expected 200 for PUBLISHED game versions, got ${pubVerRes.status}`);
  const pubVerJson = await pubVerRes.json();
  if (!pubVerJson.success || pubVerJson.data.length === 0) throw new Error('Expected active versions returned for public game');

  // Quarantined version filtering: add version with quarantined jar asset
  testDb.exec(`
    INSERT INTO game_assets (id, asset_type, storage_key, original_filename, mime_type, file_size, sha256, status, created_at)
    VALUES ('ast-jar-quarantined', 'JAR', 'games/bounce-tales/versions/bad/bad.jar', 'bad.jar', 'application/java-archive', 100, 'badsha', 'QUARANTINED', datetime('now'));
    INSERT INTO game_versions (id, game_id, version_name, jar_asset_id, jar_sha256, file_size, status, created_at)
    VALUES ('ver-bounce-bad', 'gam-bounce', '2.0.0-bad', 'ast-jar-quarantined', 'badsha', 100, 'ACTIVE', datetime('now'));
  `);
  const pubVerRes2 = await request('/api/v1/games/gam-bounce/versions');
  const pubVerJson2 = await pubVerRes2.json();
  const hasBadVer = pubVerJson2.data.some((v: any) => v.id === 'ver-bounce-bad');
  if (hasBadVer) throw new Error('Quarantined jar version must not be returned in public versions API');

  // Public game detail should also exclude quarantined version
  const bounceDetailRes = await request('/api/v1/games/bounce-tales');
  const bounceDetailJson = await bounceDetailRes.json();
  if (bounceDetailJson.data.versions.some((v: any) => v.id === 'ver-bounce-bad')) {
    throw new Error('Quarantined jar version must not be returned in public game detail');
  }
  console.log('   ✓ Public Versions & Detail Guard chặn DRAFT/HIDDEN/ARCHIVED/PRIVATE và Quarantined asset chính xác');

  // 13. Asset Delivery Authorization (S1)
  console.log('13. Kiểm tra Phân Quyền Phát Asset Trực Tiếp (S1)...');
  // Setup sample 100-byte file in storage for bounce tales and private import
  const sample100Bytes = new Uint8Array(100);
  for (let i = 0; i < 100; i++) sample100Bytes[i] = i;
  await storageDriver.put('games/bounce-tales/versions/1.0.0/game.jar', sample100Bytes, 'application/java-archive');

  // Setup User A private import
  const samplePrivateBytes = new Uint8Array(50);
  samplePrivateBytes.fill(42);
  await storageDriver.put('users/usr-player-01/imports/ast-import-01/custom.jar', samplePrivateBytes, 'application/java-archive');
  testDb.exec(`
    INSERT INTO game_assets (id, owner_user_id, asset_type, storage_key, original_filename, mime_type, file_size, sha256, status, created_at)
    VALUES ('ast-import-01', 'usr-player-01', 'JAR', 'users/usr-player-01/imports/ast-import-01/custom.jar', 'MyImport.jar', 'application/java-archive', 50, 'importsha', 'ACTIVE', datetime('now'));
    INSERT INTO user_library (id, user_id, custom_asset_id, custom_name, source_type, created_at)
    VALUES ('lib-import-01', 'usr-player-01', 'ast-import-01', 'My Custom Game', 'IMPORT', datetime('now'));
  `);

  const userAToken = await createJwt({ userId: 'usr-player-01', username: 'gamer9x', role: 'USER' }, env.JWT_SECRET);
  const userBToken = userToken; // gamer_moi from test 5

  // A. Guest accessing Public Catalog Asset -> 200 OK
  storageGetCalls = 0;
  const guestPubRes = await request('/api/v1/assets/raw/games%2Fbounce-tales%2Fversions%2F1.0.0%2Fgame.jar');
  if (guestPubRes.status !== 200) throw new Error(`Expected 200 for guest on public asset, got ${guestPubRes.status}`);
  if (guestPubRes.headers.get('Content-Disposition') !== 'attachment; filename="BounceTales.jar"') {
    throw new Error('Invalid Content-Disposition header');
  }
  if (guestPubRes.headers.get('X-Content-Type-Options') !== 'nosniff') {
    throw new Error('Missing X-Content-Type-Options: nosniff header');
  }
  if (storageGetCalls === 0) throw new Error('Expected storage.get to be called on authorized request');

  // B. Guest accessing Private User Import -> 401 Unauthorized, no storage read
  storageGetCalls = 0;
  const guestPrivRes = await request('/api/v1/assets/raw/users%2Fusr-player-01%2Fimports%2Fast-import-01%2Fcustom.jar');
  if (guestPrivRes.status !== 401) throw new Error(`Expected 401 for guest on private import, got ${guestPrivRes.status}`);
  if (guestPrivRes.headers.get('Cache-Control') !== 'private, no-store') {
    throw new Error('Denial must use Cache-Control: private, no-store');
  }
  if (storageGetCalls !== 0) throw new Error('SPY VIOLATION: storage.get was called on denied guest request');

  // C. User B (different user) accessing User A's private import -> 403 Forbidden, no storage read
  storageGetCalls = 0;
  const userBPrivRes = await request('/api/v1/assets/raw/users%2Fusr-player-01%2Fimports%2Fast-import-01%2Fcustom.jar', {
    headers: { Authorization: `Bearer ${userBToken}` },
  });
  if (userBPrivRes.status !== 403) throw new Error(`Expected 403 for user B on user A import, got ${userBPrivRes.status}`);
  if (storageGetCalls !== 0) throw new Error('SPY VIOLATION: storage.get was called on denied user B request');

  // D. User A (owner) accessing own private import -> 200 OK
  const userAPrivRes = await request('/api/v1/assets/raw/users%2Fusr-player-01%2Fimports%2Fast-import-01%2Fcustom.jar', {
    headers: { Authorization: `Bearer ${userAToken}` },
  });
  if (userAPrivRes.status !== 200) throw new Error(`Expected 200 for owner on private import, got ${userAPrivRes.status}`);

  // E. User A when BLOCKED in database -> 403 Forbidden, no storage read
  testDb.exec("UPDATE users SET status = 'BLOCKED' WHERE id = 'usr-player-01'");
  storageGetCalls = 0;
  const blockedOwnerRes = await request('/api/v1/assets/raw/users%2Fusr-player-01%2Fimports%2Fast-import-01%2Fcustom.jar', {
    headers: { Authorization: `Bearer ${userAToken}` },
  });
  if (blockedOwnerRes.status !== 403) throw new Error(`Expected 403 for blocked owner, got ${blockedOwnerRes.status}`);
  if (storageGetCalls !== 0) throw new Error('SPY VIOLATION: storage.get was called on blocked owner request');
  // Restore User A to ACTIVE
  testDb.exec("UPDATE users SET status = 'ACTIVE' WHERE id = 'usr-player-01'");

  // F. Downgraded Admin (token has ADMIN role, but DB has role 'USER') -> 403 Forbidden, no storage read
  testDb.exec("UPDATE users SET role = 'USER' WHERE id = 'usr-admin-01'");
  storageGetCalls = 0;
  const downgradedAdminRes = await request('/api/v1/assets/raw/users%2Fusr-player-01%2Fimports%2Fast-import-01%2Fcustom.jar', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (downgradedAdminRes.status !== 403) throw new Error(`Expected 403 for downgraded admin, got ${downgradedAdminRes.status}`);
  if (storageGetCalls !== 0) throw new Error('SPY VIOLATION: storage.get was called on downgraded admin request');
  // Restore Admin role
  testDb.exec("UPDATE users SET role = 'ADMIN' WHERE id = 'usr-admin-01'");

  // G. Active Admin accessing User A's private import -> 200 OK
  const activeAdminRes = await request('/api/v1/assets/raw/users%2Fusr-player-01%2Fimports%2Fast-import-01%2Fcustom.jar', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (activeAdminRes.status !== 200) throw new Error(`Expected 200 for active admin on user import, got ${activeAdminRes.status}`);

  // H. Quarantined asset accessed by Admin -> 403 Forbidden, no storage read
  storageGetCalls = 0;
  const quarRes = await request('/api/v1/assets/raw/games%2Fbounce-tales%2Fversions%2Fbad%2Fbad.jar', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (quarRes.status !== 403) throw new Error(`Expected 403 for quarantined asset even with admin, got ${quarRes.status}`);
  if (storageGetCalls !== 0) throw new Error('SPY VIOLATION: storage.get was called on quarantined asset request');

  // I. Pseudo-catalog key with "games/" prefix but not in published catalog -> 404, no storage read
  storageGetCalls = 0;
  const pseudoRes = await request('/api/v1/assets/raw/games%2Ffake-game%2Fversions%2Fver-1%2Ffake.jar');
  if (pseudoRes.status !== 404) throw new Error(`Expected 404 for pseudo-catalog key, got ${pseudoRes.status}`);
  if (storageGetCalls !== 0) throw new Error('SPY VIOLATION: storage.get was called on pseudo-catalog request');

  // J. Traversal key -> 404, no storage read
  storageGetCalls = 0;
  const travRes = await request('/api/v1/assets/raw/..%2F..%2Fetc%2Fpasswd');
  if (travRes.status !== 404) throw new Error(`Expected 404 for traversal key, got ${travRes.status}`);
  if (storageGetCalls !== 0) throw new Error('SPY VIOLATION: storage.get was called on traversal key request');

  // K. Double-encoded key -> 404, no storage read
  storageGetCalls = 0;
  const doubleEncRes = await request('/api/v1/assets/raw/games%252Fbounce-tales%252Fversions%252F1.0.0%252Fgame.jar');
  if (doubleEncRes.status !== 404) throw new Error(`Expected 404 for double-encoded key, got ${doubleEncRes.status}`);
  if (storageGetCalls !== 0) throw new Error('SPY VIOLATION: storage.get was called on double-encoded key request');
  console.log('   ✓ Phân quyền phát asset (Guest/UserA/UserB/Admin/Blocked/Quarantined) và Spy chặn đọc storage PASS');

  // 14. HTTP Range and HEAD contract tests
  console.log('14. Kiểm tra HTTP Range và HEAD requests...');
  // A. HEAD request on public asset -> 200 OK, empty body, Content-Length=100
  const headRes = await request('/api/v1/assets/raw/games%2Fbounce-tales%2Fversions%2F1.0.0%2Fgame.jar', {
    method: 'HEAD',
  });
  if (headRes.status !== 200) throw new Error(`Expected 200 for HEAD, got ${headRes.status}`);
  if (headRes.headers.get('Content-Length') !== '100') throw new Error(`Expected Content-Length: 100 on HEAD, got ${headRes.headers.get('Content-Length')}`);
  const headBody = await headRes.text();
  if (headBody.length !== 0) throw new Error(`Expected empty body on HEAD, got length ${headBody.length}`);

  // B. Closed Range: bytes=0-9 (first 10 bytes)
  const range1Res = await request('/api/v1/assets/raw/games%2Fbounce-tales%2Fversions%2F1.0.0%2Fgame.jar', {
    headers: { Range: 'bytes=0-9' },
  });
  if (range1Res.status !== 206) throw new Error(`Expected 206, got ${range1Res.status}`);
  if (range1Res.headers.get('Content-Range') !== 'bytes 0-9/100') throw new Error(`Invalid Content-Range: ${range1Res.headers.get('Content-Range')}`);
  if (range1Res.headers.get('Content-Length') !== '10') throw new Error(`Invalid Content-Length: ${range1Res.headers.get('Content-Length')}`);
  const bytes1 = new Uint8Array(await range1Res.arrayBuffer());
  if (bytes1.length !== 10 || bytes1[0] !== 0 || bytes1[9] !== 9) throw new Error('Byte slice mismatch in closed range');

  // C. Open-ended Range: bytes=90- (last 10 bytes)
  const range2Res = await request('/api/v1/assets/raw/games%2Fbounce-tales%2Fversions%2F1.0.0%2Fgame.jar', {
    headers: { Range: 'bytes=90-' },
  });
  if (range2Res.status !== 206) throw new Error(`Expected 206, got ${range2Res.status}`);
  if (range2Res.headers.get('Content-Range') !== 'bytes 90-99/100') throw new Error(`Invalid Content-Range: ${range2Res.headers.get('Content-Range')}`);
  const bytes2 = new Uint8Array(await range2Res.arrayBuffer());
  if (bytes2.length !== 10 || bytes2[0] !== 90 || bytes2[9] !== 99) throw new Error('Byte slice mismatch in open-ended range');

  // D. Suffix Range: bytes=-15 (last 15 bytes: 85-99)
  const range3Res = await request('/api/v1/assets/raw/games%2Fbounce-tales%2Fversions%2F1.0.0%2Fgame.jar', {
    headers: { Range: 'bytes=-15' },
  });
  if (range3Res.status !== 206) throw new Error(`Expected 206, got ${range3Res.status}`);
  if (range3Res.headers.get('Content-Range') !== 'bytes 85-99/100') throw new Error(`Invalid Content-Range: ${range3Res.headers.get('Content-Range')}`);
  const bytes3 = new Uint8Array(await range3Res.arrayBuffer());
  if (bytes3.length !== 15 || bytes3[0] !== 85 || bytes3[14] !== 99) throw new Error('Byte slice mismatch in suffix range');

  // E. Clamp EOF Range: bytes=95-999 (should clamp end to 99)
  const range4Res = await request('/api/v1/assets/raw/games%2Fbounce-tales%2Fversions%2F1.0.0%2Fgame.jar', {
    headers: { Range: 'bytes=95-999' },
  });
  if (range4Res.status !== 206) throw new Error(`Expected 206 for over-EOF clamp, got ${range4Res.status}`);
  if (range4Res.headers.get('Content-Range') !== 'bytes 95-99/100') throw new Error(`Invalid Content-Range for clamp: ${range4Res.headers.get('Content-Range')}`);
  if (range4Res.headers.get('Content-Length') !== '5') throw new Error(`Invalid Content-Length for clamp: ${range4Res.headers.get('Content-Length')}`);

  // F. Unsatisfiable Range: bytes=200-300 -> 416
  const range5Res = await request('/api/v1/assets/raw/games%2Fbounce-tales%2Fversions%2F1.0.0%2Fgame.jar', {
    headers: { Range: 'bytes=200-300' },
  });
  if (range5Res.status !== 416) throw new Error(`Expected 416 for unsatisfiable range, got ${range5Res.status}`);
  if (range5Res.headers.get('Content-Range') !== 'bytes */100') throw new Error(`Expected Content-Range: bytes */100, got ${range5Res.headers.get('Content-Range')}`);

  // G. Malformed Range: bytes=invalid -> 416
  const range6Res = await request('/api/v1/assets/raw/games%2Fbounce-tales%2Fversions%2F1.0.0%2Fgame.jar', {
    headers: { Range: 'bytes=abc-def' },
  });
  if (range6Res.status !== 416) throw new Error(`Expected 416 for malformed range, got ${range6Res.status}`);

  // H. Multiple Range: bytes=0-5,10-15 -> 416
  const range7Res = await request('/api/v1/assets/raw/games%2Fbounce-tales%2Fversions%2F1.0.0%2Fgame.jar', {
    headers: { Range: 'bytes=0-5,10-15' },
  });
  if (range7Res.status !== 416) throw new Error(`Expected 416 for multiple range, got ${range7Res.status}`);

  // I. HEAD with Range: bytes=0-9 -> 206, Content-Range, empty body
  const headRangeRes = await request('/api/v1/assets/raw/games%2Fbounce-tales%2Fversions%2F1.0.0%2Fgame.jar', {
    method: 'HEAD',
    headers: { Range: 'bytes=0-9' },
  });
  if (headRangeRes.status !== 206) throw new Error(`Expected 206 for HEAD with range, got ${headRangeRes.status}`);
  if (headRangeRes.headers.get('Content-Range') !== 'bytes 0-9/100') throw new Error('Invalid Content-Range for HEAD');
  const headRangeText = await headRangeRes.text();
  if (headRangeText.length !== 0) throw new Error('HEAD with range must not return body');
  console.log('   ✓ HTTP Range (Closed/Open/Suffix/Clamp/416/Multiple) và HEAD PASS');

  // 15. Dynamic State Transitions
  console.log('15. Kiểm tra Chuyển Trạng Thái (Publish -> Hide & Active -> Quarantined)...');
  // Hide a previously public game (gam-space)
  await storageDriver.put('games/space-impact/versions/1.0.0/game.jar', new Uint8Array([1, 2, 3]), 'application/java-archive');
  const spacePublicRes = await request('/api/v1/assets/raw/games%2Fspace-impact%2Fversions%2F1.0.0%2Fgame.jar');
  if (spacePublicRes.status !== 200) throw new Error('Expected 200 before hiding');

  // Transition to HIDDEN
  testDb.exec("UPDATE games SET status = 'HIDDEN' WHERE id = 'gam-space'");
  const spaceHiddenRes = await request('/api/v1/assets/raw/games%2Fspace-impact%2Fversions%2F1.0.0%2Fgame.jar');
  if (spaceHiddenRes.status !== 401 && spaceHiddenRes.status !== 404) {
    throw new Error(`Expected 401/404 after game hidden, got ${spaceHiddenRes.status}`);
  }

  // Transition asset to QUARANTINED
  testDb.exec("UPDATE game_assets SET status = 'QUARANTINED' WHERE storage_key = 'games/space-impact/versions/1.0.0/game.jar'");
  const spaceQuarRes = await request('/api/v1/assets/raw/games%2Fspace-impact%2Fversions%2F1.0.0%2Fgame.jar', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (spaceQuarRes.status !== 403) {
    throw new Error(`Expected 403 after asset quarantined, got ${spaceQuarRes.status}`);
  }
  console.log('   ✓ Chuyển đổi trạng thái động (PUBLISHED->HIDDEN & ACTIVE->QUARANTINED) tức thì PASS');

  // 16. Crawler Service & Safe Import Checks (Review Round 02)
  console.log('16. Kiểm tra Crawler DRAFT, Bảo Mật Tải, Publish và Trùng Lặp (R02)...');

  // A. User thường gọi route crawler nhận 403
  const userCrawlerRes = await request('/api/v1/admin/crawler/import', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ gameId: 'DiamondRush' }),
  });
  if (userCrawlerRes.status !== 403) {
    throw new Error(`Expected 403 for user calling crawler import, got ${userCrawlerRes.status}`);
  }

  const userBatchRes = await request('/api/v1/admin/crawler/batch-import', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ gameIds: ['DiamondRush'] }),
  });
  if (userBatchRes.status !== 403) {
    throw new Error(`Expected 403 for user calling crawler batch-import, got ${userBatchRes.status}`);
  }
  console.log('   ✓ User thường bị chặn 403 khi gọi route crawler PASS');

  // Setup synthetic stub for fetch
  const originalFetch = globalThis.fetch;
  const validSyntheticJar = createSyntheticJar('Manifest-Version: 1.0\r\nMIDlet-Name: DiamondRush\r\nMIDlet-1: DiamondRush,,com.gameloft.DiamondRush\r\n');
  const validSyntheticPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(16).fill(1)]);

  let requestedUrls: string[] = [];
  let customFetchHandler: ((url: string, init?: RequestInit) => Promise<Response> | Response) | null = null;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(urlStr);

    if (customFetchHandler) {
      return customFetchHandler(urlStr, init);
    }

    if (urlStr.endsWith('.jar')) {
      return new Response(validSyntheticJar, {
        status: 200,
        headers: { 'Content-Type': 'application/java-archive' },
      });
    }

    if (urlStr.includes('icon') || urlStr.endsWith('.png')) {
      return new Response(validSyntheticPng, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    }

    return new Response('Not found', { status: 404 });
  };

  try {
    // B. Import creates game in DRAFT with plan 4.4 key
    const importRes = await request('/api/v1/admin/crawler/import', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ gameId: 'DiamondRush' }),
    });
    if (importRes.status !== 200) {
      const errText = await importRes.text();
      throw new Error(`Import failed with status ${importRes.status}: ${errText}`);
    }
    const importJson = await importRes.json();
    const importedGame = importJson.data.game;
    const importedVersion = importJson.data.version;

    if (importedGame.status !== 'DRAFT') {
      throw new Error(`Expected imported game status to be DRAFT, got ${importedGame.status}`);
    }
    const expectedJarKey = `games/${importedGame.id}/versions/${importedVersion.id}/game.jar`;
    const jarAssetRow = testDb.prepare('SELECT * FROM game_assets WHERE id = ?').get(importedVersion.jar_asset_id) as any;
    if (!jarAssetRow || jarAssetRow.storage_key !== expectedJarKey) {
      throw new Error(`Expected jar storage_key to be ${expectedJarKey}, got ${jarAssetRow?.storage_key}`);
    }

    // Public list must not show DRAFT game
    const publicListRes = await request('/api/v1/games');
    const publicListJson = await publicListRes.json();
    const foundInList = publicListJson.data.some((g: any) => g.id === importedGame.id);
    if (foundInList) throw new Error('DRAFT game must not appear in public games list');

    // Public detail must 404
    const publicDetailRes = await request(`/api/v1/games/${importedGame.slug}`);
    if (publicDetailRes.status !== 404) {
      throw new Error(`Expected 404 for public detail of DRAFT game, got ${publicDetailRes.status}`);
    }

    // Public versions must 404
    const publicVersionsRes = await request(`/api/v1/games/${importedGame.id}/versions`);
    if (publicVersionsRes.status !== 404) {
      throw new Error(`Expected 404 for public versions of DRAFT game, got ${publicVersionsRes.status}`);
    }

    // Raw asset delivery must be denied to anonymous guest
    const rawGuestRes = await request(`/api/v1/assets/raw/${encodeURIComponent(expectedJarKey)}`);
    if (rawGuestRes.status !== 401 && rawGuestRes.status !== 404) {
      throw new Error(`Expected raw asset to be denied to guest before publish, got ${rawGuestRes.status}`);
    }
    console.log('   ✓ Import tạo game DRAFT, ẩn hoàn toàn khỏi Catalog công khai PASS');

    // C. Sau POST /admin/games/:id/publish -> Chơi được ngay
    const publishRes = await request(`/api/v1/admin/games/${importedGame.id}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (publishRes.status !== 200) {
      const errText = await publishRes.text();
      throw new Error(`Publish failed with status ${publishRes.status}: ${errText}`);
    }

    // Now public detail returns 200 with versions
    const publishedDetailRes = await request(`/api/v1/games/${importedGame.slug}`);
    if (publishedDetailRes.status !== 200) {
      throw new Error(`Expected 200 for detail after publish, got ${publishedDetailRes.status}`);
    }
    const publishedDetailJson = await publishedDetailRes.json();
    if (!publishedDetailJson.data.versions || publishedDetailJson.data.versions.length !== 1) {
      throw new Error('Expected published game detail to contain exactly 1 version');
    }

    // Raw asset delivery now returns 200 with exact bytes to guest
    const rawPublishedRes = await request(`/api/v1/assets/raw/${encodeURIComponent(expectedJarKey)}`);
    if (rawPublishedRes.status !== 200) {
      throw new Error(`Expected 200 for raw asset delivery to guest after publish, got ${rawPublishedRes.status}`);
    }
    const deliveredBytes = new Uint8Array(await rawPublishedRes.arrayBuffer());
    if (deliveredBytes.length !== validSyntheticJar.length || deliveredBytes[0] !== 0x50) {
      throw new Error('Delivered bytes do not match synthetic JAR');
    }
    console.log('   ✓ Sau khi Admin bấm Publish, game lập tức chơi được công khai với đúng bytes PASS');

    // D. Import trùng SHA-256 trả 409
    const countBeforeDupe = (testDb.prepare('SELECT count(*) as c FROM games').get() as any).c;
    const dupeRes = await request('/api/v1/admin/crawler/import', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ gameId: 'NinjaSchool1' }),
    });
    if (dupeRes.status !== 409) {
      throw new Error(`Expected 409 Conflict for duplicate SHA-256, got ${dupeRes.status}`);
    }
    const dupeJson = await dupeRes.json();
    if (!dupeJson.error?.slug) {
      throw new Error('Expected 409 response to include existing game slug');
    }
    const countAfterDupe = (testDb.prepare('SELECT count(*) as c FROM games').get() as any).c;
    if (countBeforeDupe !== countAfterDupe) {
      throw new Error('Duplicate import must not create any new game record');
    }
    console.log('   ✓ Chống trùng SHA-256 trả 409 Conflict chính xác PASS');

    // E. An toàn khi tải: JAR hỏng, file quá lớn, redirect sang host lạ, icon host lạ, cover không phải ảnh
    const gamesBeforeFail = (testDb.prepare('SELECT count(*) as c FROM games').get() as any).c;
    const assetsBeforeFail = (testDb.prepare('SELECT count(*) as c FROM game_assets').get() as any).c;

    // E1: Invalid JAR format
    customFetchHandler = async (url) => {
      if (url.endsWith('.jar')) return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
      return new Response(validSyntheticPng, { status: 200 });
    };
    const invalidJarRes = await request('/api/v1/admin/crawler/import', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: 'NinjaSchool1' }),
    });
    if (invalidJarRes.status !== 400) throw new Error(`Expected 400 for invalid JAR, got ${invalidJarRes.status}`);

    // E2: Redirect sang host khác
    customFetchHandler = async (url) => {
      if (url.includes('gametuoitho.cc')) {
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://evil.attacker.com/malicious.jar' },
        });
      }
      return new Response('Should not be called', { status: 500 });
    };
    requestedUrls = [];
    const redirectRes = await request('/api/v1/admin/crawler/import', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: 'NinjaSchool1' }),
    });
    if (redirectRes.status !== 400) throw new Error(`Expected 400 for cross-host redirect, got ${redirectRes.status}`);
    if (requestedUrls.some((u) => u.includes('evil.attacker.com'))) {
      throw new Error('Security violation: request made to foreign host!');
    }

    // E3: Cover không phải ảnh
    customFetchHandler = async (url) => {
      if (url.endsWith('.jar')) return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...Array(28).fill(9)]), { status: 200 });
      return new Response('This is plain text not an image', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    };
    const invalidCoverRes = await request('/api/v1/admin/crawler/import', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: 'NinjaSchool1' }),
    });
    if (invalidCoverRes.status !== 400) throw new Error(`Expected 400 for invalid cover, got ${invalidCoverRes.status}`);

    // Atomicity check: no orphan records created during all failed attempts
    const gamesAfterFail = (testDb.prepare('SELECT count(*) as c FROM games').get() as any).c;
    const assetsAfterFail = (testDb.prepare('SELECT count(*) as c FROM game_assets').get() as any).c;
    if (gamesBeforeFail !== gamesAfterFail || assetsBeforeFail !== assetsAfterFail) {
      throw new Error('Atomicity violation: orphan game or asset record remained after failed import');
    }
    console.log('   ✓ Tính an toàn và nguyên tử khi tải (chặn host lạ, validate MIME, không mồ côi) PASS');

    // F. Batch vượt giới hạn & batch hợp lệ
    customFetchHandler = null; // restore normal synthetic
    let byteSeed = 20;
    customFetchHandler = async (url) => {
      if (url.endsWith('.jar')) {
        byteSeed++;
        const jarWithSeed = createSyntheticJar(`Manifest-Version: 1.0\r\nMIDlet-Name: NinjaSchool1\r\nMIDlet-1: NinjaSchool1,,com.teamobi.Ninja\r\nSeed: ${byteSeed}\r\n`);
        return new Response(jarWithSeed, { status: 200 });
      }
      return new Response(validSyntheticPng, { status: 200 });
    };

    // Batch > 20
    const overLimitIds = Array.from({ length: 21 }, (_, i) => `game-${i}`);
    const overLimitRes = await request('/api/v1/admin/crawler/batch-import', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameIds: overLimitIds }),
    });
    if (overLimitRes.status !== 400) {
      throw new Error(`Expected 400 for batch over 20 items, got ${overLimitRes.status}`);
    }

    // Valid batch
    const validBatchRes = await request('/api/v1/admin/crawler/batch-import', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameIds: ['NinjaSchool1'] }),
    });
    if (validBatchRes.status !== 200) {
      throw new Error(`Expected 200 for valid batch, got ${validBatchRes.status}`);
    }
    const batchJson = await validBatchRes.json();
    if (!batchJson.data || !Array.isArray(batchJson.data.results) || batchJson.data.results.length !== 1) {
      throw new Error('Invalid batch results structure');
    }
    if (batchJson.data.results[0].ok !== true) {
      throw new Error(`Expected batch item to succeed, error: ${batchJson.data.results[0].error}`);
    }
    console.log('   ✓ Giới hạn batch và kết quả batch chi tiết theo từng game PASS');

  } finally {
    globalThis.fetch = originalFetch;
  }

    // 17. Kiểm tra 404 API Route & Fallback behavior (R03)
    console.log('17. Kiểm tra 404 API Route & Fallback behavior (R03)...');
    const notFoundApiRes = await request('/api/v1/unknown-endpoint');
    if (notFoundApiRes.status !== 404) {
      throw new Error(`Expected 404 for unknown API endpoint, got ${notFoundApiRes.status}`);
    }
    console.log('   ✓ Unknown API endpoints return genuine 404 PASS');

    // 18. R04: Quản lý & Dọn dẹp dung lượng lưu trữ (An toàn xóa, Bulk Delete, JSON 404, Safety Window)
    console.log('18. Kiểm tra R04: Xóa an toàn, Bulk Delete, JSON 404 & Safety Window...');

    // A. Fallback JSON 404 cho mọi HTTP method trên endpoint không tồn tại
    const delUnknown = await request('/api/v1/admin/storage/assets/foo', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (delUnknown.status !== 404) {
      throw new Error(`Expected 404 for DELETE unknown route, got ${delUnknown.status}`);
    }
    const delContentType = delUnknown.headers.get('content-type') || '';
    if (!delContentType.includes('application/json')) {
      throw new Error(`Expected application/json content-type on 404, got ${delContentType}`);
    }
    const delJson = await delUnknown.json();
    if (delJson.success !== false || delJson.error?.code !== 'NOT_FOUND') {
      throw new Error(`Expected error.code === 'NOT_FOUND', got ${JSON.stringify(delJson)}`);
    }

    const postUnknown = await request('/api/v1/unknown', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (postUnknown.status !== 404 || !(await postUnknown.json()).error?.code) {
      throw new Error('Expected 404 JSON for POST unknown');
    }

    const putUnknown = await request('/api/v1/games/foo/bar', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (putUnknown.status !== 404 || !(await putUnknown.json()).error?.code) {
      throw new Error('Expected 404 JSON for PUT unknown');
    }
    console.log('   ✓ Fallback JSON 404 cho DELETE/POST/PUT trên route không tồn tại PASS');

    // B. apiRequest không crash khi nhận text/plain response
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () =>
        new Response('404 Not Found (Plain Text)', {
          status: 404,
          headers: { 'Content-Type': 'text/plain' },
        });
      const parsedRes = await apiRequest('/some-endpoint');
      if (parsedRes.success !== false || !parsedRes.error?.message) {
        throw new Error('Expected apiRequest to return structured error on non-JSON response');
      }
      if (!parsedRes.error.message.includes('404')) {
        throw new Error(`Expected error message to mention status code, got ${parsedRes.error.message}`);
      }
    } finally {
      globalThis.fetch = origFetch;
    }
    console.log('   ✓ apiRequest xử lý an toàn response non-JSON (không ném SyntaxError) PASS');

    // C. Xóa asset có tham chiếu bị từ chối an toàn (409)
    // 1. JAR tham chiếu bởi Game Version
    const refJarAssetId = 'test-ref-jar-1';
    const refJarKey = 'games/ref-game.jar';
    const refJarPath = path.join(testUploadDir, 'games', 'ref-game.jar');
    fs.mkdirSync(path.dirname(refJarPath), { recursive: true });
    fs.writeFileSync(refJarPath, Buffer.from('TEST_JAR_CONTENT'));
    testDb.prepare(
      `INSERT INTO game_assets (id, storage_key, asset_type, original_filename, mime_type, file_size, sha256, status, created_at)
       VALUES (?, ?, 'JAR', 'ref-game.jar', 'application/java-archive', 16, 'hash-jar-1', 'ACTIVE', datetime('now'))`
    ).run(refJarAssetId, refJarKey);

    const testGameId = 'test-game-for-version';
    testDb.prepare(
      `INSERT INTO games (id, name, slug, description, category_id, status, visibility, created_at, updated_at)
       VALUES (?, 'Game Test Version', 'game-test-version', 'Desc', 'cat-rpg', 'PUBLISHED', 'PUBLIC', datetime('now'), datetime('now'))`
    ).run(testGameId);

    const testVersionId = 'test-ver-1';
    testDb.prepare(
      `INSERT INTO game_versions (id, game_id, version_name, jar_asset_id, jar_sha256, file_size, status, created_at)
       VALUES (?, ?, '1.0.0', ?, 'hash-jar-1', 16, 'ACTIVE', datetime('now'))`
    ).run(testVersionId, testGameId, refJarAssetId);

    const delRefJarRes = await request(`/api/v1/admin/assets/${refJarAssetId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (delRefJarRes.status !== 409) {
      throw new Error(`Expected 409 Conflict when deleting referenced JAR, got ${delRefJarRes.status}`);
    }
    const delRefJarJson = await delRefJarRes.json();
    if (delRefJarJson.error?.code !== 'CONFLICT') {
      throw new Error(`Expected error code CONFLICT, got ${delRefJarJson.error?.code}`);
    }
    if (!fs.existsSync(refJarPath)) {
      throw new Error('Physical JAR file was unexpectedly deleted on 409');
    }
    const dbAssetCheck = testDb.prepare('SELECT id FROM game_assets WHERE id = ?').get(refJarAssetId);
    if (!dbAssetCheck) {
      throw new Error('Asset record was unexpectedly deleted from DB on 409');
    }
    console.log('   ✓ Từ chối xóa JAR asset đang được Catalog version tham chiếu (409) PASS');

    // 2. Cover tham chiếu bởi Game
    const refCoverAssetId = 'test-ref-cover-1';
    const refCoverKey = 'covers/ref-cover.png';
    const refCoverPath = path.join(testUploadDir, 'covers', 'ref-cover.png');
    fs.mkdirSync(path.dirname(refCoverPath), { recursive: true });
    fs.writeFileSync(refCoverPath, Buffer.from('TEST_COVER_CONTENT'));
    testDb.prepare(
      `INSERT INTO game_assets (id, storage_key, asset_type, original_filename, mime_type, file_size, sha256, status, created_at)
       VALUES (?, ?, 'COVER', 'ref-cover.png', 'image/png', 18, 'hash-cover-1', 'ACTIVE', datetime('now'))`
    ).run(refCoverAssetId, refCoverKey);

    const coverGameId = 'test-game-with-cover';
    testDb.prepare(
      `INSERT INTO games (id, name, slug, description, category_id, cover_asset_id, status, visibility, created_at, updated_at)
       VALUES (?, 'Game With Cover', 'game-with-cover', 'Desc', 'cat-rpg', ?, 'PUBLISHED', 'PUBLIC', datetime('now'), datetime('now'))`
    ).run(coverGameId, refCoverAssetId);

    const delRefCoverRes = await request(`/api/v1/admin/assets/${refCoverAssetId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (delRefCoverRes.status !== 409) {
      throw new Error(`Expected 409 Conflict when deleting referenced cover, got ${delRefCoverRes.status}`);
    }
    if (!fs.existsSync(refCoverPath)) {
      throw new Error('Physical cover file was unexpectedly deleted on 409');
    }
    console.log('   ✓ Từ chối xóa Cover asset đang được Game Catalog tham chiếu (409) PASS');

    // D. Xóa asset không tham chiếu thành công (200)
    const unrefAssetId = 'test-unref-asset-1';
    const unrefKey = 'temp/unref.png';
    const unrefPath = path.join(testUploadDir, 'temp', 'unref.png');
    fs.mkdirSync(path.dirname(unrefPath), { recursive: true });
    fs.writeFileSync(unrefPath, Buffer.from('TEST_UNREF_CONTENT'));
    testDb.prepare(
      `INSERT INTO game_assets (id, storage_key, asset_type, original_filename, mime_type, file_size, sha256, status, created_at)
       VALUES (?, ?, 'COVER', 'unref.png', 'image/png', 18, 'hash-unref-1', 'ACTIVE', datetime('now'))`
    ).run(unrefAssetId, unrefKey);

    const delUnrefRes = await request(`/api/v1/admin/assets/${unrefAssetId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (delUnrefRes.status !== 200) {
      throw new Error(`Expected 200 when deleting unreferenced asset, got ${delUnrefRes.status}`);
    }
    if (fs.existsSync(unrefPath)) {
      throw new Error('Physical file still exists after successful deletion');
    }
    const checkDeletedDb = testDb.prepare('SELECT id FROM game_assets WHERE id = ?').get(unrefAssetId);
    if (checkDeletedDb) {
      throw new Error('DB record still exists after successful deletion');
    }
    console.log('   ✓ Xóa asset không tham chiếu thành công (DB xóa trước, file xóa sau) PASS');

    // E. Xóa asset là user import (xóa user_library và game_assets, trả về affected user)
    const userImportAssetId = 'test-user-import-asset-1';
    const userImportKey = 'users/usr-player-01/my-import.jar';
    const userImportPath = path.join(testUploadDir, 'users', 'usr-player-01', 'my-import.jar');
    fs.mkdirSync(path.dirname(userImportPath), { recursive: true });
    fs.writeFileSync(userImportPath, Buffer.from('TEST_USER_IMPORT_JAR'));
    testDb.prepare(
      `INSERT INTO game_assets (id, storage_key, asset_type, original_filename, mime_type, file_size, sha256, status, created_at)
       VALUES (?, ?, 'JAR', 'my-import.jar', 'application/java-archive', 20, 'hash-user-import-1', 'ACTIVE', datetime('now'))`
    ).run(userImportAssetId, userImportKey);

    const userLibId = 'test-user-lib-item-1';
    testDb.prepare(
      `INSERT INTO user_library (id, user_id, custom_asset_id, custom_name, source_type, created_at)
       VALUES (?, 'usr-player-01', ?, 'My Imported Game', 'IMPORT', datetime('now'))`
    ).run(userLibId, userImportAssetId);

    const delUserImportRes = await request(`/api/v1/admin/assets/${userImportAssetId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (delUserImportRes.status !== 200) {
      throw new Error(`Expected 200 when deleting user import asset, got ${delUserImportRes.status}`);
    }
    const delUserImportJson = await delUserImportRes.json();
    if (!delUserImportJson.data?.affectedUsers || delUserImportJson.data.affectedUsers[0]?.userId !== 'usr-player-01') {
      throw new Error(`Expected affectedUsers in response, got ${JSON.stringify(delUserImportJson.data)}`);
    }
    if (fs.existsSync(userImportPath)) {
      throw new Error('User import file was not deleted from disk');
    }
    const checkUserLib = testDb.prepare('SELECT id FROM user_library WHERE id = ?').get(userLibId);
    if (checkUserLib) {
      throw new Error('User library item was not deleted when asset was deleted');
    }
    const checkUserAsset = testDb.prepare('SELECT id FROM game_assets WHERE id = ?').get(userImportAssetId);
    if (checkUserAsset) {
      throw new Error('User import game_assets record was not deleted');
    }
    console.log('   ✓ Xóa User Import: dọn dẹp user_library, game_assets và trả về thông tin affected user PASS');

    // F. Bulk Delete (`POST /api/v1/admin/assets/bulk-delete`)
    const bulkOkId = 'bulk-ok-asset';
    const bulkOkPath = path.join(testUploadDir, 'temp', 'bulk-ok.png');
    fs.writeFileSync(bulkOkPath, Buffer.from('BULK_OK'));
    testDb.prepare(
      `INSERT INTO game_assets (id, storage_key, asset_type, original_filename, mime_type, file_size, sha256, status, created_at)
       VALUES (?, 'temp/bulk-ok.png', 'COVER', 'bulk-ok.png', 'image/png', 7, 'hash-bulk-1', 'ACTIVE', datetime('now'))`
    ).run(bulkOkId);

    const bulkRefId = refJarAssetId;
    const bulkNonexistentId = 'nonexistent-asset-9999';

    const bulkRes = await request('/api/v1/admin/assets/bulk-delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [bulkOkId, bulkRefId, bulkNonexistentId] }),
    });
    if (bulkRes.status !== 200) {
      throw new Error(`Expected 200 for bulk-delete, got ${bulkRes.status}`);
    }
    const bulkJson = await bulkRes.json();
    if (!bulkJson.data?.results || !Array.isArray(bulkJson.data.results) || bulkJson.data.results.length !== 3) {
      throw new Error(`Invalid bulk-delete response structure: ${JSON.stringify(bulkJson)}`);
    }
    const resMap = new Map(bulkJson.data.results.map((r: any) => [r.id, r]));
    if (!resMap.get(bulkOkId)?.ok) {
      throw new Error('Expected bulk-ok item to have ok: true');
    }
    if (resMap.get(bulkRefId)?.ok !== false || resMap.get(bulkRefId)?.status !== 409) {
      throw new Error(`Expected bulk-ref item to have ok: false and status: 409, got ${JSON.stringify(resMap.get(bulkRefId))}`);
    }
    if (resMap.get(bulkNonexistentId)?.ok !== false || resMap.get(bulkNonexistentId)?.status !== 404) {
      throw new Error(`Expected bulk-nonexistent item to have ok: false and status: 404, got ${JSON.stringify(resMap.get(bulkNonexistentId))}`);
    }
    if (fs.existsSync(bulkOkPath)) {
      throw new Error('bulkOk physical file was not deleted');
    }
    if (!fs.existsSync(refJarPath)) {
      throw new Error('bulkRef physical file was deleted unexpectedly in bulk-delete');
    }

    // Limit check > 100
    const over100Ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    const bulkOverLimitRes = await request('/api/v1/admin/assets/bulk-delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: over100Ids }),
    });
    if (bulkOverLimitRes.status !== 400) {
      throw new Error(`Expected 400 for bulk-delete with > 100 IDs, got ${bulkOverLimitRes.status}`);
    }
    console.log('   ✓ Bulk delete xử lý từng mục độc lập (thành công, 409, 404) và chặn > 100 IDs PASS');

    // G. Phân quyền bảo mật (Role-Based Authorization)
    const forbiddenDel = await request(`/api/v1/admin/assets/${refJarAssetId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (forbiddenDel.status !== 403) {
      throw new Error(`Expected 403 when regular user calls DELETE /admin/assets/:id, got ${forbiddenDel.status}`);
    }

    const forbiddenBulk = await request('/api/v1/admin/assets/bulk-delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['any-id'] }),
    });
    if (forbiddenBulk.status !== 403) {
      throw new Error(`Expected 403 when regular user calls POST /admin/assets/bulk-delete, got ${forbiddenBulk.status}`);
    }
    console.log('   ✓ Quyền truy cập: Người dùng thông thường bị chặn 403 trên các route xóa asset PASS');

    // H. Cleanup Storage: Window an toàn 15 phút & Bảo vệ Catalog Assets
    const recentOrphanPath = path.join(testUploadDir, 'temp', 'recent-orphan.bin');
    fs.writeFileSync(recentOrphanPath, Buffer.from('RECENT_ORPHAN_DATA'));

    const oldOrphanPath = path.join(testUploadDir, 'temp', 'old-orphan.bin');
    fs.writeFileSync(oldOrphanPath, Buffer.from('OLD_ORPHAN_DATA'));
    // Set modification time to 30 minutes in the past
    const pastTime = new Date(Date.now() - 30 * 60 * 1000);
    fs.utimesSync(oldOrphanPath, pastTime, pastTime);

    const cleanupRes = await request('/api/v1/admin/storage/cleanup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cleanOrphans: true, purgeDeleted: true, safetyWindowMs: 15 * 60 * 1000 }),
    });
    if (cleanupRes.status !== 200) {
      throw new Error(`Expected 200 for cleanup storage, got ${cleanupRes.status}`);
    }
    if (!fs.existsSync(recentOrphanPath)) {
      throw new Error('Recent orphan within 15-minute safety window was unexpectedly deleted');
    }
    if (fs.existsSync(oldOrphanPath)) {
      throw new Error('Old orphan outside safety window was not deleted');
    }
    if (!fs.existsSync(refJarPath)) {
      throw new Error('Catalog referenced asset was deleted during cleanup');
    }
    console.log('   ✓ Cleanup Storage: Bỏ qua file mới trong safety window 15 phút và bảo toàn catalog files PASS');

    // 19. PM Review Round 05 Suite (Bảo mật phiên, Publish/Version Policy, Crash Reports, JAR validation, Audit Logs)
    console.log('19. Kiểm tra PM Review Round 05 Suite (R05-A, B, C, D, E)...');

    // 19.1 R05-A: Tampered JWT rejected
    const tamperedToken = adminToken.slice(0, -6) + 'abcdef';
    const tamperedRes = await request('/api/v1/admin/stats', {
      headers: { Authorization: `Bearer ${tamperedToken}` },
    });
    if (tamperedRes.status !== 401) {
      throw new Error(`Expected 401 for tampered JWT, got ${tamperedRes.status}`);
    }

    // 19.2 R05-A: Cookie parsing ignores csrftoken= or xtoken=
    const csrfCookieRes = await request('/api/v1/admin/stats', {
      headers: { Cookie: `csrftoken=${adminToken}; other_cookie=123` },
    });
    if (csrfCookieRes.status !== 401) {
      throw new Error(`Expected 401 when only csrftoken is provided, got ${csrfCookieRes.status}`);
    }

    const exactCookieRes = await request('/api/v1/admin/stats', {
      headers: { Cookie: `csrftoken=fake; token=${adminToken}; other=123` },
    });
    if (exactCookieRes.status !== 200) {
      throw new Error(`Expected 200 when exact token cookie is provided, got ${exactCookieRes.status}`);
    }

    // 19.3 R05-A: Session Revocation via Logout
    // Create new dedicated user for session testing
    const sessionUserRes = await request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'session_test_user',
        email: 'session@gametuoitho.vn',
        password: 'password123',
      }),
    });
    const sessionUserJson = await sessionUserRes.json();
    const sessionTokenBefore = sessionUserJson.data.token;
    const sessionUserId = sessionUserJson.data.user.id;

    // Verify token works
    const testSessionRes1 = await request('/api/v1/me/library', {
      headers: { Authorization: `Bearer ${sessionTokenBefore}` },
    });
    if (testSessionRes1.status !== 200) {
      throw new Error('Initial session token should be valid');
    }

    // Call Logout
    const logoutRes = await request('/api/v1/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionTokenBefore}` },
    });
    if (logoutRes.status !== 200) {
      throw new Error(`Expected 200 for logout, got ${logoutRes.status}`);
    }

    // Previous token MUST now be revoked immediately (401)
    const testSessionRes2 = await request('/api/v1/me/library', {
      headers: { Authorization: `Bearer ${sessionTokenBefore}` },
    });
    if (testSessionRes2.status !== 401) {
      throw new Error(`Expected 401 for revoked token after logout, got ${testSessionRes2.status}`);
    }

    // Re-login obtains new token with updated token_version
    const reLoginRes = await request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usernameOrEmail: 'session_test_user',
        password: 'password123',
      }),
    });
    const reLoginJson = await reLoginRes.json();
    const sessionTokenAfter = reLoginJson.data.token;

    const testSessionRes3 = await request('/api/v1/me/library', {
      headers: { Authorization: `Bearer ${sessionTokenAfter}` },
    });
    if (testSessionRes3.status !== 200) {
      throw new Error('New token after re-login should be valid');
    }

    // Blocking user immediately invalidates active token
    testDb.exec(`UPDATE users SET status = 'BLOCKED' WHERE id = '${sessionUserId}'`);
    const blockedRes = await request('/api/v1/me/library', {
      headers: { Authorization: `Bearer ${sessionTokenAfter}` },
    });
    if (blockedRes.status !== 401) {
      throw new Error(`Expected 401 for blocked user, got ${blockedRes.status}`);
    }

    // 19.4 R05-B: Single Policy for Game Publish & Version
    // Creating game with PUBLISHED directly must be rejected (400)
    const createPubRes = await request('/api/v1/admin/games', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Unpublished Invalid Game',
        slug: 'unpublished-invalid-game',
        category_id: 'cat-action',
        status: 'PUBLISHED',
      }),
    });
    if (createPubRes.status !== 400) {
      throw new Error(`Expected 400 when creating game directly with PUBLISHED status, got ${createPubRes.status}`);
    }

    // Creating game as DRAFT succeeds
    const createDraftRes = await request('/api/v1/admin/games', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Policy Test Game',
        slug: 'policy-test-game',
        category_id: 'cat-action',
        status: 'DRAFT',
      }),
    });
    if (createDraftRes.status !== 201) {
      throw new Error(`Expected 201 for creating DRAFT game, got ${createDraftRes.status}`);
    }
    const policyGameId = (await createDraftRes.json()).data.id;

    // Attempting to publish without versions -> rejected 400
    const pubWithoutVerRes = await request(`/api/v1/admin/games/${policyGameId}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (pubWithoutVerRes.status !== 400) {
      throw new Error(`Expected 400 when publishing game with no versions, got ${pubWithoutVerRes.status}`);
    }

    // Attaching user import JAR (users/...) to Catalog version -> rejected 400
    const userImportJarId = 'ast-user-illegal-import';
    testDb.exec(`
      INSERT INTO game_assets (id, owner_user_id, asset_type, storage_key, original_filename, mime_type, file_size, sha256, status, created_at)
      VALUES ('${userImportJarId}', 'usr-player-01', 'JAR', 'users/usr-player-01/imports/illegal.jar', 'illegal.jar', 'application/java-archive', 100, 'sha-illegal', 'ACTIVE', datetime('now'))
    `);

    const attachUserJarRes = await request(`/api/v1/admin/games/${policyGameId}/versions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version_name: '1.0.0-illegal',
        jar_asset_id: userImportJarId,
      }),
    });
    if (attachUserJarRes.status !== 400) {
      throw new Error(`Expected 400 when attaching user import JAR to catalog game, got ${attachUserJarRes.status}`);
    }

    // Create valid Catalog JAR asset
    const catalogJarId = 'ast-valid-catalog-jar';
    testDb.exec(`
      INSERT INTO game_assets (id, owner_user_id, asset_type, storage_key, original_filename, mime_type, file_size, sha256, status, created_at)
      VALUES ('${catalogJarId}', 'usr-admin-01', 'JAR', 'games/${policyGameId}/versions/v1/game.jar', 'game.jar', 'application/java-archive', 100, 'sha-catalog-jar', 'ACTIVE', datetime('now'))
    `);

    // Attach valid Catalog JAR version -> succeeds (201)
    const attachValidVerRes = await request(`/api/v1/admin/games/${policyGameId}/versions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version_name: '1.0.0',
        jar_asset_id: catalogJarId,
      }),
    });
    if (attachValidVerRes.status !== 201) {
      throw new Error(`Expected 201 for attaching valid catalog version, got ${attachValidVerRes.status}`);
    }
    const policyVersionId = (await attachValidVerRes.json()).data.id;

    // Publishing now succeeds (200)
    const publishOkRes = await request(`/api/v1/admin/games/${policyGameId}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (publishOkRes.status !== 200) {
      throw new Error(`Expected 200 for publishing valid game, got ${publishOkRes.status}`);
    }

    // 404 checks on nonexistent items
    const nonGameHideRes = await request('/api/v1/admin/games/nonexistent-id/hide', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (nonGameHideRes.status !== 404) {
      throw new Error(`Expected 404 for hiding nonexistent game, got ${nonGameHideRes.status}`);
    }

    const nonGameDelRes = await request('/api/v1/admin/games/nonexistent-id', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (nonGameDelRes.status !== 404) {
      throw new Error(`Expected 404 for deleting nonexistent game, got ${nonGameDelRes.status}`);
    }

    const nonVerDelRes = await request(`/api/v1/admin/games/${policyGameId}/versions/nonexistent-version`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (nonVerDelRes.status !== 404) {
      throw new Error(`Expected 404 for deleting nonexistent version, got ${nonVerDelRes.status}`);
    }

    // Verify audit logs recorded
    const auditCount = (testDb.prepare("SELECT count(*) as count FROM audit_logs").get() as any)?.count || 0;
    if (auditCount === 0) {
      throw new Error('Expected audit logs to be recorded');
    }

    // 19.5 R05-C: validateJarFile rejects 22-byte empty ZIP and no-manifest ZIP
    const empty22ByteZip = new Uint8Array([
      0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    const emptyZipCheck = validateJarFile(empty22ByteZip);
    if (emptyZipCheck.valid) {
      throw new Error('validateJarFile must reject 22-byte empty ZIP file');
    }

    // 19.6 R05-D: Crash Reports (Payload limit, Rate limit, Zod validation)
    // A. Payload > 32KB -> 413
    const bigPayload = JSON.stringify({
      error_message: 'Large report',
      stack_trace: 'A'.repeat(33 * 1024),
    });
    const bigReportRes = await request('/api/v1/reports/crash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(bigPayload.length) },
      body: bigPayload,
    });
    if (bigReportRes.status !== 413) {
      throw new Error(`Expected 413 Payload Too Large, got ${bigReportRes.status}`);
    }

    // B. Invalid JSON / Empty error message -> 400
    const invalidReportRes = await request('/api/v1/reports/crash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error_message: '' }),
    });
    if (invalidReportRes.status !== 400) {
      throw new Error(`Expected 400 for empty error_message, got ${invalidReportRes.status}`);
    }

    // C. Nonexistent game_id -> 400
    const nonGameReportRes = await request('/api/v1/reports/crash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        game_id: 'nonexistent-game-id',
        error_message: 'Game crashed during loading',
      }),
    });
    if (nonGameReportRes.status !== 400) {
      throw new Error(`Expected 400 for report with nonexistent game_id, got ${nonGameReportRes.status}`);
    }

    // D. Valid report with game_id -> 200, checks DB game name
    const validReportRes = await request('/api/v1/reports/crash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        game_id: policyGameId,
        game_name: 'Fake Name Provided By Client',
        error_message: 'Midlet exception: NullPointerException',
        error_type: 'CRASH',
      }),
    });
    if (validReportRes.status !== 200) {
      throw new Error(`Expected 200 for valid crash report, got ${validReportRes.status}`);
    }
    const validReportId = (await validReportRes.json()).data.id;
    const dbReport = testDb.prepare('SELECT game_name FROM game_crash_reports WHERE id = ?').get(validReportId) as any;
    if (dbReport.game_name !== 'Policy Test Game') {
      throw new Error(`Expected authoritative game_name "Policy Test Game", got "${dbReport.game_name}"`);
    }

    // E. Rate limiting: > 10 requests / min -> 429
    let rateLimited = false;
    for (let i = 0; i < 15; i++) {
      const rlRes = await request('/api/v1/reports/crash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '192.0.2.100' },
        body: JSON.stringify({
          error_message: `Stress crash test ${i}`,
          error_type: 'CRASH',
        }),
      });
      if (rlRes.status === 429) {
        rateLimited = true;
        break;
      }
    }
    if (!rateLimited) {
      throw new Error('Expected rate limiting (429) after > 10 report requests');
    }

    // 19.7 R05F-C: Bootstrap First Administrator
    // A. Cannot bootstrap if admin already exists in testDb
    const rejectExistingAdmin = await bootstrapAdmin(dbClient, {
      username: 'another_admin',
      email: 'another@test.vn',
      password: 'StrongPassword123',
    });
    if (rejectExistingAdmin.success || rejectExistingAdmin.code !== 'ADMIN_EXISTS') {
      throw new Error(`Expected ADMIN_EXISTS rejection when admin already in DB, got ${rejectExistingAdmin.code}`);
    }

    // B. Fresh database bootstrap
    const freshDb = new Database(':memory:');
    freshDb.pragma('foreign_keys = ON');
    const freshClient = new SqliteDatabaseClient(freshDb);
    runMigrations(freshClient, migrationsDir);

    // Verify 0 admins in fresh DB
    const preCount = (freshDb.prepare("SELECT count(*) as c FROM users WHERE role = 'ADMIN'").get() as any).c;
    if (preCount !== 0) throw new Error('Fresh DB must have 0 admins');

    // Missing info -> rejected
    const rejectMissing = await bootstrapAdmin(freshClient, {
      username: 'admin',
      email: '',
      password: 'pass',
    });
    if (rejectMissing.success || rejectMissing.code !== 'INVALID_INPUT') {
      throw new Error(`Expected INVALID_INPUT, got ${rejectMissing.code}`);
    }

    // Weak password (< 8 chars) -> rejected
    const rejectWeak = await bootstrapAdmin(freshClient, {
      username: 'admin',
      email: 'admin@test.vn',
      password: 'short',
    });
    if (rejectWeak.success || rejectWeak.code !== 'WEAK_PASSWORD') {
      throw new Error(`Expected WEAK_PASSWORD, got ${rejectWeak.code}`);
    }

    // Valid bootstrap credentials -> succeeds
    const bootstrapSuccess = await bootstrapAdmin(freshClient, {
      username: 'super_admin',
      email: 'super@gametuoitho.vn',
      password: 'StrongAdminPassword@2026',
    });
    if (!bootstrapSuccess.success || bootstrapSuccess.code !== 'SUCCESS' || !bootstrapSuccess.userId) {
      throw new Error(`Expected SUCCESS for bootstrap admin, got ${bootstrapSuccess.code}: ${bootstrapSuccess.message}`);
    }

    // Calling bootstrap again now fails because admin exists
    const secondCall = await bootstrapAdmin(freshClient, {
      username: 'second_admin',
      email: 'second@gametuoitho.vn',
      password: 'AnotherPassword@2026',
    });
    if (secondCall.success || secondCall.code !== 'ADMIN_EXISTS') {
      throw new Error(`Expected ADMIN_EXISTS on second bootstrap call, got ${secondCall.code}`);
    }

    // Test newly bootstrapped admin can authenticate and access admin routes
    const freshApp = createApp(freshClient, storageDriver);
    const freshLoginRes = await freshApp.fetch(
      new Request('http://localhost:8787/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usernameOrEmail: 'super_admin',
          password: 'StrongAdminPassword@2026',
        }),
      }),
      env
    );
    if (freshLoginRes.status !== 200) {
      throw new Error(`Fresh bootstrapped admin login failed with status ${freshLoginRes.status}`);
    }
    const freshLoginJson = await freshLoginRes.json();
    const freshToken = freshLoginJson.data.token;
    if (!freshToken || freshLoginJson.data.user.role !== 'ADMIN') {
      throw new Error('Bootstrapped admin token or role invalid');
    }

    // Access protected admin route with bootstrapped admin token
    const freshAdminAccessRes = await freshApp.fetch(
      new Request('http://localhost:8787/api/v1/admin/stats', {
        headers: { Authorization: `Bearer ${freshToken}` },
      }),
      env
    );
    if (freshAdminAccessRes.status !== 200) {
      throw new Error(`Expected 200 for bootstrapped admin accessing /admin/stats, got ${freshAdminAccessRes.status}`);
    }
    freshDb.close();

    console.log('   ✓ Bộ kiểm thử PM Review Round 05 (Bảo mật phiên, Publish/Version, Báo cáo lỗi, JAR check, Audit) PASS');

    // =========================================================================
    // 20. KIỂM TRA REVIEW ROUND 06:
    //     - R06-A (S4): Upload Security (Not ZIP, Empty ZIP, No Manifest, ../evil, too many entries, zip bomb, >50MB, HTML as COVER, Quota, Rate Limit)
    //     - R06-B (S6): Library, History, Favorites Ownership & Isolation
    // =========================================================================
    console.log('20. Kiểm tra Review Round 06 (Upload Security & Library Ownership)...');

    async function testUpload(token: string, fileData: Buffer | Uint8Array, filename: string, assetType: string, extraFields: Record<string, string> = {}) {
      const formData = new FormData();
      const blob = new Blob([fileData]);
      formData.append('file', blob, filename);
      formData.append('assetType', assetType);
      for (const [k, v] of Object.entries(extraFields)) {
        formData.append(k, v);
      }
      return app.fetch(
        new Request('http://localhost:8787/api/v1/upload', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        }),
        env
      );
    }

    // 20.1 Upload non-ZIP file (text/html) -> Rejected (400), quarantined, upload_job FAILED
    const nonZipData = Buffer.from('<html><body>Not a zip file</body></html>');
    const nonZipRes = await testUpload(userToken, nonZipData, 'fake.jar', 'JAR');
    if (nonZipRes.status !== 400) {
      throw new Error(`Expected 400 for non-ZIP upload, got ${nonZipRes.status}`);
    }
    const fakeAsset = testDb.prepare("SELECT * FROM game_assets WHERE original_filename = 'fake.jar'").get() as any;
    if (!fakeAsset || fakeAsset.status !== 'QUARANTINED') {
      throw new Error('Expected quarantined asset for non-ZIP upload failure');
    }
    const fakeJob = testDb.prepare("SELECT * FROM upload_jobs WHERE asset_id = ?").get(fakeAsset.id) as any;
    if (!fakeJob || fakeJob.status !== 'FAILED') {
      throw new Error('Expected FAILED upload_jobs for non-ZIP upload failure');
    }

    // 20.2 Empty ZIP file (22-byte EOCD only) -> Rejected (400)
    const emptyZipData = Buffer.alloc(22);
    emptyZipData[0] = 0x50; emptyZipData[1] = 0x4b; emptyZipData[2] = 0x05; emptyZipData[3] = 0x06;
    const emptyZipRes = await testUpload(userToken, emptyZipData, 'empty.jar', 'JAR');
    if (emptyZipRes.status !== 400) {
      throw new Error(`Expected 400 for empty ZIP upload, got ${emptyZipRes.status}`);
    }

    // 20.3 ZIP without manifest -> Rejected (400)
    const noManifestContent = Buffer.from('dummy content');
    const lh3 = Buffer.alloc(30); lh3[0] = 0x50; lh3[1] = 0x4b; lh3[2] = 0x03; lh3[3] = 0x04;
    lh3.writeUInt32LE(noManifestContent.length, 18);
    lh3.writeUInt32LE(noManifestContent.length, 22);
    lh3.writeUInt16LE(7, 26);
    const nmName = Buffer.from('foo.txt');
    const cd3 = Buffer.alloc(46); cd3[0] = 0x50; cd3[1] = 0x4b; cd3[2] = 0x01; cd3[3] = 0x02;
    cd3.writeUInt32LE(noManifestContent.length, 20);
    cd3.writeUInt32LE(noManifestContent.length, 24);
    cd3.writeUInt16LE(7, 28);
    const eocd3 = Buffer.alloc(22); eocd3[0] = 0x50; eocd3[1] = 0x4b; eocd3[2] = 0x05; eocd3[3] = 0x06;
    eocd3.writeUInt16LE(1, 8); eocd3.writeUInt16LE(1, 10);
    eocd3.writeUInt32LE(46 + 7, 12);
    eocd3.writeUInt32LE(30 + 7 + noManifestContent.length, 16);
    const noManifestZip = Buffer.concat([lh3, nmName, noManifestContent, cd3, nmName, eocd3]);
    const noManifestRes = await testUpload(userToken, noManifestZip, 'nomanifest.jar', 'JAR');
    if (noManifestRes.status !== 400) {
      throw new Error(`Expected 400 for ZIP without manifest, got ${noManifestRes.status}`);
    }

    // 20.4 ZIP with path traversal "../evil" -> Rejected (400)
    const evilJar = createSyntheticJar('MIDlet-Name: Good\r\nMIDlet-1: Good,,com.test.Good\r\n', [
      { name: '../evil.txt', data: 'malicious' },
    ]);
    const evilRes = await testUpload(userToken, evilJar, 'evil.jar', 'JAR');
    if (evilRes.status !== 400) {
      throw new Error(`Expected 400 for ZIP with ../ traversal, got ${evilRes.status}`);
    }

    // 20.5 ZIP with too many entries (>10,000) -> Rejected (400)
    const tooManyJar = createSyntheticJar(
      'MIDlet-Name: Good\r\nMIDlet-1: Good,,com.test.Good\r\n',
      [],
      { totalEntriesOverride: 10001 }
    );
    const tooManyRes = await testUpload(userToken, tooManyJar, 'toomany.jar', 'JAR');
    if (tooManyRes.status !== 400) {
      throw new Error(`Expected 400 for ZIP with >10,000 entries, got ${tooManyRes.status}`);
    }

    // 20.6 ZIP bomb (declared uncompressed size > 200MB) -> Rejected (400)
    const bombJar = createSyntheticJar(
      'MIDlet-Name: Good\r\nMIDlet-1: Good,,com.test.Good\r\n',
      [{ name: 'bomb.bin', data: Buffer.alloc(10), uncompSize: 250 * 1024 * 1024 }]
    );
    const bombRes = await testUpload(userToken, bombJar, 'bomb.jar', 'JAR');
    if (bombRes.status !== 400) {
      throw new Error(`Expected 400 for ZIP bomb, got ${bombRes.status}`);
    }

    // 20.7 File too large (>50MB) -> Rejected with 413
    const largeRes = await app.fetch(
      new Request('http://localhost:8787/api/v1/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Length': '55000000',
        },
        body: 'dummy',
      }),
      env
    );
    if (largeRes.status !== 413) {
      throw new Error(`Expected 413 for payload >50MB, got ${largeRes.status}`);
    }

    // 20.8 Claim assetType=COVER but send HTML (x.html) -> Rejected (400) & No .html storage key
    const htmlCover = Buffer.from('<html><head><script>alert(1)</script></head><body>evil</body></html>');
    const htmlCoverRes = await testUpload(adminToken, htmlCover, 'x.html', 'COVER', { gameId: 'ninja-school' });
    if (htmlCoverRes.status !== 400) {
      throw new Error(`Expected 400 for HTML uploaded as COVER, got ${htmlCoverRes.status}`);
    }
    const htmlAsset = testDb.prepare("SELECT * FROM game_assets WHERE original_filename = 'x.html'").get() as any;
    if (!htmlAsset || htmlAsset.status !== 'QUARANTINED') {
      throw new Error('Expected quarantined asset for invalid COVER upload');
    }
    if (htmlAsset.storage_key.endsWith('.html')) {
      throw new Error(`Storage key must not have .html extension: ${htmlAsset.storage_key}`);
    }

    // 20.9 Valid COVER upload with PNG bytes -> 201 Created & server determined mime and extension
    const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    const validCoverRes = await testUpload(adminToken, validPng, 'cover.png', 'COVER', { gameId: 'ninja-school' });
    if (validCoverRes.status !== 201) {
      throw new Error(`Expected 201 for valid PNG COVER, got ${validCoverRes.status}`);
    }
    const validCoverJson = await validCoverRes.json();
    if (validCoverJson.data.mime_type !== 'image/png' || !validCoverJson.data.storage_key.endsWith('.png')) {
      throw new Error(`Invalid mime or storage_key: ${JSON.stringify(validCoverJson.data)}`);
    }

    // 20.10 Regular user quota and rate limit enforcement
    // Setup user for quota test
    testDb.prepare(`
      INSERT OR REPLACE INTO users (id, username, email, password_hash, role, status, token_version, created_at, updated_at)
      VALUES ('usr-quota-test', 'quotaman', 'quota@gametuoitho.vn', 'hash', 'USER', 'ACTIVE', 0, datetime('now'), datetime('now'))
    `).run();
    const quotaToken = await createJwt({ userId: 'usr-quota-test', username: 'quotaman', email: 'quota@gametuoitho.vn', role: 'USER' }, env.JWT_SECRET);

    // Fill user storage quota to 200MB (200 * 1024 * 1024 = 209715200 bytes)
    testDb.prepare(`
      INSERT INTO game_assets (id, owner_user_id, asset_type, storage_key, original_filename, mime_type, file_size, sha256, status, created_at)
      VALUES ('ast-heavy-01', 'usr-quota-test', 'JAR', 'users/usr-quota-test/imports/heavy/game.jar', 'heavy.jar', 'application/java-archive', 210000000, 'sha-heavy', 'ACTIVE', datetime('now'))
    `).run();

    const validJarBytes = createSyntheticJar('Manifest-Version: 1.0\r\nMIDlet-Name: Safe\r\nMIDlet-1: Safe,,com.safe.Midlet\r\n');
    const quotaExceededRes = await testUpload(quotaToken, validJarBytes, 'safe.jar', 'JAR');
    if (quotaExceededRes.status !== 413) {
      throw new Error(`Expected 413 for user exceeding storage quota, got ${quotaExceededRes.status}`);
    }

    // Rate limit test (>10 uploads per minute)
    testDb.prepare(`
      INSERT OR REPLACE INTO users (id, username, email, password_hash, role, status, token_version, created_at, updated_at)
      VALUES ('usr-rate-test', 'rateman', 'rate@gametuoitho.vn', 'hash', 'USER', 'ACTIVE', 0, datetime('now'), datetime('now'))
    `).run();
    const rateToken = await createJwt({ userId: 'usr-rate-test', username: 'rateman', email: 'rate@gametuoitho.vn', role: 'USER' }, env.JWT_SECRET);
    for (let i = 0; i < 10; i++) {
      testDb.prepare(`
        INSERT INTO upload_jobs (id, user_id, asset_id, status, created_at, updated_at)
        VALUES (?, 'usr-rate-test', 'ast-heavy-01', 'COMPLETED', datetime('now'), datetime('now'))
      `).run(`rate-job-${i}`);
    }
    const rateLimitedRes = await testUpload(rateToken, validJarBytes, 'rate.jar', 'JAR');
    if (rateLimitedRes.status !== 429) {
      throw new Error(`Expected 429 for user exceeding rate limit, got ${rateLimitedRes.status}`);
    }

    // 20.11 Library & Activity Security & Isolation (R06-B)
    // Setup users A and B
    testDb.prepare(`
      INSERT OR REPLACE INTO users (id, username, email, password_hash, role, status, token_version, created_at, updated_at)
      VALUES
        ('usr-a', 'user_a', 'user_a@gametuoitho.vn', 'hash', 'USER', 'ACTIVE', 0, datetime('now'), datetime('now')),
        ('usr-b', 'user_b', 'user_b@gametuoitho.vn', 'hash', 'USER', 'ACTIVE', 0, datetime('now'), datetime('now'));
    `).run();
    const tokenA = await createJwt({ userId: 'usr-a', username: 'user_a', email: 'user_a@gametuoitho.vn', role: 'USER' }, env.JWT_SECRET);
    const tokenB = await createJwt({ userId: 'usr-b', username: 'user_b', email: 'user_b@gametuoitho.vn', role: 'USER' }, env.JWT_SECRET);

    // Create DRAFT game in catalog
    testDb.prepare(`
      INSERT OR REPLACE INTO games (id, name, slug, category_id, status, visibility, source_type, created_at, updated_at)
      VALUES ('game-draft-secret', 'Draft Secret Game', 'draft-secret-game', 'cat-rpg', 'DRAFT', 'PUBLIC', 'ADMIN', datetime('now'), datetime('now'))
    `).run();

    // User A cannot add DRAFT game to library
    const addDraftRes = await app.fetch(
      new Request('http://localhost:8787/api/v1/me/library', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ game_id: 'game-draft-secret' }),
      }),
      env
    );
    if (addDraftRes.status !== 400) {
      throw new Error(`Expected 400 when adding DRAFT game to library, got ${addDraftRes.status}`);
    }

    // User A cannot favorite DRAFT game
    const favDraftRes = await app.fetch(
      new Request('http://localhost:8787/api/v1/me/favorites', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ game_id: 'game-draft-secret' }),
      }),
      env
    );
    if (favDraftRes.status !== 400) {
      throw new Error(`Expected 400 when favoriting DRAFT game, got ${favDraftRes.status}`);
    }

    // User B uploads an import and adds to library
    const uploadBRes = await testUpload(tokenB, validJarBytes, 'game_b.jar', 'JAR');
    if (uploadBRes.status !== 201) {
      throw new Error(`Expected 201 for user B import upload, got ${uploadBRes.status}`);
    }
    const assetB = (await uploadBRes.json()).data;

    const addImportBRes = await app.fetch(
      new Request('http://localhost:8787/api/v1/me/imports', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jar_asset_id: assetB.id, custom_name: 'B Confidential SuperGame' }),
      }),
      env
    );
    if (addImportBRes.status !== 201) {
      throw new Error(`Expected 201 for user B import add, got ${addImportBRes.status}`);
    }

    // Anti-duplication: User B cannot add same import twice
    const dupImportRes = await app.fetch(
      new Request('http://localhost:8787/api/v1/me/imports', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jar_asset_id: assetB.id, custom_name: 'Duplicate Add Attempt' }),
      }),
      env
    );
    if (dupImportRes.status !== 400) {
      throw new Error(`Expected 400 when adding duplicate import asset, got ${dupImportRes.status}`);
    }

    // Find User B's library item ID
    const bLibItem = testDb.prepare("SELECT id FROM user_library WHERE user_id = 'usr-b' AND custom_asset_id = ?").get(assetB.id) as any;
    if (!bLibItem) {
      throw new Error('User B library item not found');
    }

    // User A cannot record play pointing to User B's library item
    const hostilePlayRes = await app.fetch(
      new Request('http://localhost:8787/api/v1/me/history', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_library_id: bLibItem.id }),
      }),
      env
    );
    if (hostilePlayRes.status !== 400) {
      throw new Error(`Expected 400 when recording play pointing to another user's library item, got ${hostilePlayRes.status}`);
    }

    // Even if an activity somehow references B's library item, User A's history query does NOT leak B's custom_name
    testDb.prepare(`
      INSERT INTO user_game_activity (id, user_id, user_library_id, activity_type, last_played_at, play_count)
      VALUES ('act-hostile', 'usr-a', ?, 'PLAY', datetime('now'), 1)
    `).run(bLibItem.id);

    const historyARes = await app.fetch(
      new Request('http://localhost:8787/api/v1/me/history', {
        headers: { Authorization: `Bearer ${tokenA}` },
      }),
      env
    );
    if (historyARes.status !== 200) {
      throw new Error(`Expected 200 for user A get history, got ${historyARes.status}`);
    }
    const historyAJson = await historyARes.json();
    for (const h of historyAJson.data) {
      if (h.custom_name === 'B Confidential SuperGame') {
        throw new Error('LEAK DETECTED: User A saw User B custom_name in play history!');
      }
    }

    console.log('   ✓ Bộ kiểm thử PM Review Round 06 (Upload Security, Quota/Rate Limit, Library & Activity Isolation) PASS');

    // -------------------------------------------------------------------------
    // BỘ KIỂM THỬ 21: Deflate Manifest JAR Validation & Upload (R06 Fix 01 P0)
    // -------------------------------------------------------------------------
    console.log('\n--- BỘ KIỂM THỬ 21: Deflate Manifest JAR Validation & Upload (R06 Fix 01 P0) ---');

    // 1. Direct validation of Deflate-compressed synthetic JAR
    const validDeflateJar = createDeflateSyntheticJar();
    const validDeflateResult = await validateJarFile(new Uint8Array(validDeflateJar));
    if (!validDeflateResult.valid) {
      throw new Error(`Expected validDeflateResult to be valid, got error: ${validDeflateResult.error}`);
    }

    // 2. Direct validation of corrupt Deflate synthetic JAR (must return { valid: false, error }, NEVER throw)
    const corruptDeflateJar = createDeflateSyntheticJar({ corruptDeflate: true });
    let corruptResult: { valid: boolean; error?: string };
    try {
      corruptResult = await validateJarFile(new Uint8Array(corruptDeflateJar));
    } catch (e: any) {
      throw new Error(`validateJarFile threw an exception on corrupt deflate data instead of returning error: ${e.message}`);
    }
    if (corruptResult.valid) {
      throw new Error('Expected corrupt deflate JAR to be invalid, but got valid: true');
    }
    if (!corruptResult.error) {
      throw new Error('Expected corrupt deflate JAR to contain error message');
    }

    // 3. Mini ZIP bomb protection: Deflate JAR with uncompSize exceeding 64KB
    const zipBombDeflateJar = createDeflateSyntheticJar({ uncompSizeOverride: 128 * 1024 });
    const zipBombResult = await validateJarFile(new Uint8Array(zipBombDeflateJar));
    if (zipBombResult.valid) {
      throw new Error('Expected mini zip bomb manifest (>64KB) to be invalid');
    }

    // 4. Upload valid Deflate JAR via /upload API -> 201
    const uploadDeflateRes = await testUpload(tokenA, validDeflateJar, 'super_deflate_game.jar', 'JAR');
    if (uploadDeflateRes.status !== 201) {
      const errBody = await uploadDeflateRes.text();
      throw new Error(`Expected 201 when uploading Deflate JAR, got ${uploadDeflateRes.status}: ${errBody}`);
    }
    const uploadedDeflateAsset = (await uploadDeflateRes.json()).data;
    if (!uploadedDeflateAsset.id || uploadedDeflateAsset.status !== 'ACTIVE') {
      throw new Error('Uploaded Deflate asset is not active or missing ID');
    }

    // 5. Upload corrupt Deflate JAR via /upload API -> 400 (not 500, no server crash)
    const uploadCorruptRes = await testUpload(tokenA, corruptDeflateJar, 'corrupt_deflate.jar', 'JAR');
    if (uploadCorruptRes.status !== 400) {
      throw new Error(`Expected 400 when uploading corrupt Deflate JAR, got ${uploadCorruptRes.status}`);
    }

    console.log('   ✓ Bộ kiểm thử 21: Deflate Manifest JAR Validation, Corrupt Deflate Handling & Upload PASS');

    // Check for any unhandled rejection or uncaught exception during tests
    if (unhandledRejectionCount > 0) {
      throw new Error(`FAILED: ${unhandledRejectionCount} unhandled rejection(s) detected during test execution! Last error: ${lastUnhandledError}`);
    }
    if (uncaughtExceptionCount > 0) {
      throw new Error(`FAILED: ${uncaughtExceptionCount} uncaught exception(s) detected during test execution! Last error: ${lastUnhandledError}`);
    }

    console.log('\n=============================================');
    console.log('🎉 TẤT CẢ 22 BỘ TEST ĐÃ HOÀN THÀNH XUẤT SẮC! 🎉');
    console.log('=============================================');
  } finally {
    // Clean up test uploads
    if (fs.existsSync(testUploadDir)) {
      fs.rmSync(testUploadDir, { recursive: true, force: true });
    }
  }
}

runTests().catch((err) => {
  console.error('❌ Kiểm thử thất bại:', err);
  process.exit(1);
});
