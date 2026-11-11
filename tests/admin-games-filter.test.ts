// Admin game list filter for homepage "Game ưa thích" (GET /api/v1/admin/games?featured=...).
import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createApp } from '../apps/api/src/index';
import { SqliteDatabaseClient } from '../apps/api/src/repositories/db';
import { runMigrations } from '../apps/api/src/repositories/migrationRunner';
import { createJwt } from '../packages/shared-utils/src/index';

async function main() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  try {
    runMigrations(sqlite, path.resolve(__dirname, '../database/migrations'));
    sqlite.exec(`
      INSERT INTO users(id, username, email, password_hash, role) VALUES
        ('admin', 'filter_admin', 'admin@filter.invalid', 'unused', 'ADMIN'),
        ('user', 'filter_user', 'user@filter.invalid', 'unused', 'USER');
      INSERT INTO categories(id, name, slug) VALUES ('category', 'Hành động', 'hanh-dong');
      INSERT INTO games(id, name, slug, category_id, status, visibility, source_type, created_by, is_featured) VALUES
        ('pub-star', 'Bounce Star', 'bounce-star', 'category', 'PUBLISHED', 'PUBLIC', 'ADMIN', 'admin', 1),
        ('draft-star', 'Draft Star', 'draft-star', 'category', 'DRAFT', 'PRIVATE', 'ADMIN', 'admin', 1),
        ('pub-plain', 'Bounce Plain', 'bounce-plain', 'category', 'PUBLISHED', 'PUBLIC', 'ADMIN', 'admin', 0),
        ('hidden-plain', 'Hidden Plain', 'hidden-plain', 'category', 'HIDDEN', 'PRIVATE', 'ADMIN', 'admin', 0);
    `);
    const db = new SqliteDatabaseClient(sqlite);
    const storage = { put: async () => {}, get: async () => null, delete: async () => {}, getUrl: (key: string) => `/api/v1/assets/raw/${key}` };
    const app = createApp(db, storage as any);
    const env = { JWT_SECRET: 'admin-filter-isolated-test-secret-over-32-chars', _dbClient: db, _storageDriver: storage };
    const adminToken = await createJwt({ userId: 'admin', username: 'filter_admin', role: 'ADMIN' }, env.JWT_SECRET);
    const userToken = await createJwt({ userId: 'user', username: 'filter_user', role: 'USER' }, env.JWT_SECRET);
    const list = async (query: string, token = adminToken) => {
      const response = await app.fetch(new Request(`http://localhost/api/v1/admin/games?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      }), env as any);
      const json = await response.json() as any;
      return { status: response.status, ids: (json.data || []).map((game: any) => game.id).sort(), total: json.total };
    };

    assert.equal((await list('featured=true', userToken)).status, 403);
    console.log('PASS the filter stays behind the admin check');

    assert.deepEqual((await list('')).ids, ['draft-star', 'hidden-plain', 'pub-plain', 'pub-star']);
    const featured = await list('featured=true');
    assert.deepEqual(featured.ids, ['draft-star', 'pub-star']);
    assert.equal(featured.total, 2);
    assert.deepEqual((await list('featured=false')).ids, ['hidden-plain', 'pub-plain']);
    for (const value of ['1', 'yes', '', 'TRUE']) assert.equal((await list(`featured=${value}`)).ids.length, 4, value);
    console.log('PASS featured=true / false filter; other values mean no filter');

    assert.deepEqual((await list('featured=true&status=PUBLISHED')).ids, ['pub-star']);
    assert.deepEqual((await list('featured=true&status=DRAFT')).ids, ['draft-star']);
    assert.deepEqual((await list('featured=true&status=HIDDEN')).ids, []);
    assert.deepEqual((await list('featured=true&search=Bounce')).ids, ['pub-star']);
    console.log('PASS combines with the status tab and the search box (drafts can be starred too)');

    sqlite.prepare("UPDATE games SET is_featured = 0 WHERE id = 'pub-star'").run();
    assert.deepEqual((await list('featured=true')).ids, ['draft-star']);
    console.log('PASS an un-starred game leaves the filtered list');

    // Order of "Game ưa thích": latest updated first, both in admin and on the public homepage list.
    sqlite.exec(`
      INSERT INTO games(id, name, slug, category_id, status, visibility, source_type, created_by, is_featured, created_at, updated_at) VALUES
        ('old', 'Old Favorite', 'old-favorite', 'category', 'PUBLISHED', 'PUBLIC', 'ADMIN', 'admin', 1, '2020-01-01 00:00:00', '2020-01-01 00:00:00'),
        ('mid', 'Mid Favorite', 'mid-favorite', 'category', 'PUBLISHED', 'PUBLIC', 'ADMIN', 'admin', 1, '2024-01-01 00:00:00', '2024-01-01T00:00:00.000Z'),
        ('new', 'New Favorite', 'new-favorite', 'category', 'PUBLISHED', 'PUBLIC', 'ADMIN', 'admin', 1, '2025-01-01 00:00:00', '2025-01-01 00:00:00');
      UPDATE games SET is_featured = 0 WHERE id = 'draft-star';
    `);
    const ordered = async (url: string, token: string | null = adminToken) => {
      const response = await app.fetch(new Request(`http://localhost/api/v1/${url}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }), env as any);
      return ((await response.json() as any).data || []).map((game: any) => game.id);
    };
    assert.deepEqual(await ordered('admin/games?featured=true'), ['new', 'mid', 'old']);
    assert.deepEqual(await ordered('games?featured=true&sort=newest', null), ['new', 'mid', 'old']);
    const setFeatured = (id: string, value: boolean) => app.fetch(new Request(`http://localhost/api/v1/admin/games/${id}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_featured: value }),
    }), env as any);
    assert.equal((await setFeatured('old', false)).status, 200);
    assert.equal((await setFeatured('old', true)).status, 200);
    assert.deepEqual(await ordered('admin/games?featured=true'), ['old', 'new', 'mid']);
    assert.deepEqual(await ordered('games?featured=true&sort=newest', null), ['old', 'new', 'mid']);
    console.log('PASS favorites are ordered by last update; un-star + star again moves an old game to the top');

    assert.deepEqual(await ordered('games?featured=true&sort=name', null), ['mid', 'new', 'old']);
    const catalog = await ordered('admin/games');
    assert.deepEqual(catalog.indexOf('new') < catalog.indexOf('mid') && catalog.indexOf('mid') < catalog.indexOf('old'), true);
    assert.ok(catalog.indexOf('new') > catalog.indexOf('hidden-plain'), 'the unfiltered list keeps the creation order');
    console.log('PASS an explicit sort (name) and the unfiltered lists keep their own order');
  } finally {
    sqlite.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
