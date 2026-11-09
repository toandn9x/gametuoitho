import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { createApp } from '../apps/api/src/index';
import { SqliteDatabaseClient } from '../apps/api/src/repositories/db';
import { LocalStorageDriver } from '../apps/api/src/storage/storage';

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
  const storageDriver = new LocalStorageDriver('./uploads_test', '/api/v1/assets/raw/');
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
      password: 'admin123',
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

  // Clean up test uploads
  if (fs.existsSync('./uploads_test')) {
    fs.rmSync('./uploads_test', { recursive: true, force: true });
  }

  console.log('\n=============================================');
  console.log('🎉 TẤT CẢ 10 BỘ TEST ĐÃ HOÀN THÀNH XUẤT SẮC! 🎉');
  console.log('=============================================');
}

runTests().catch((err) => {
  console.error('❌ Kiểm thử thất bại:', err);
  process.exit(1);
});
