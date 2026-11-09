import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { createApp } from '../apps/api/src/index';
import { SqliteDatabaseClient } from '../apps/api/src/repositories/db';
import { LocalStorageDriver } from '../apps/api/src/storage/storage';
import { createJwt } from '../packages/shared-utils/src/index';

async function runTests() {
  console.log('--- Bắt đầu chạy Kiểm Thử Tự Động (API & Database Tests) ---');

  const testDb = new Database(':memory:');
  const migrationSql = fs.readFileSync(
    path.resolve(__dirname, '../database/migrations/0001_initial_schema.sql'),
    'utf-8'
  );
  testDb.exec(migrationSql);

  const seedSql = fs.readFileSync(
    path.resolve(__dirname, '../database/seeds/0001_seed_data.sql'),
    'utf-8'
  );
  testDb.exec(seedSql);

  const dbClient = new SqliteDatabaseClient(testDb);
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
    JWT_SECRET: 'test-secret-key-123456',
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
  if (!gamesJson.success || !Array.isArray(gamesJson.data) || gamesJson.data.length < 6) {
    throw new Error('Expected at least 6 seeded games');
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

    console.log('\n=============================================');
    console.log('🎉 TẤT CẢ 15 BỘ TEST ĐÃ HOÀN THÀNH XUẤT SẮC! 🎉');
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
