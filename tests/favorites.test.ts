// Personal favorites API (/api/v1/me/favorites) on an isolated in-memory database.
import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createApp } from '../apps/api/src/index';
import { SqliteDatabaseClient } from '../apps/api/src/repositories/db';
import { runMigrations } from '../apps/api/src/repositories/migrationRunner';
import { createJwt } from '../packages/shared-utils/src/index';
import type { FavoriteGameItem, PlayHistoryItem } from '../packages/shared-types/src/index';

async function main() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  try {
    runMigrations(sqlite, path.resolve(__dirname, '../database/migrations'));
    sqlite.exec(`
      INSERT INTO users(id, username, email, password_hash) VALUES
        ('a', 'fav_a', 'a@fav.invalid', 'unused'), ('b', 'fav_b', 'b@fav.invalid', 'unused');
      INSERT INTO categories(id, name, slug) VALUES ('category', 'Nhập vai', 'nhap-vai');
      INSERT INTO game_assets(id, owner_user_id, asset_type, storage_key, original_filename, mime_type, sha256, status) VALUES
        ('cover-1', 'a', 'COVER', 'games/g1/cover.png', 'cover.png', 'image/png', 'fixture-cover-1', 'ACTIVE'),
        ('cover-2', 'a', 'COVER', 'games/g2/cover.png', 'cover.png', 'image/png', 'fixture-cover-2', 'DELETED');
      INSERT INTO games(id, name, slug, category_id, status, visibility, source_type, created_by, developer, cover_asset_id) VALUES
        ('g1', 'Game One', 'game-one', 'category', 'PUBLISHED', 'PUBLIC', 'ADMIN', 'a', 'Gameloft', 'cover-1'),
        ('g2', 'Game Two', 'game-two', 'category', 'PUBLISHED', 'PUBLIC', 'ADMIN', 'a', NULL, 'cover-2'),
        ('hidden', 'Hidden Game', 'hidden-game', 'category', 'DRAFT', 'PRIVATE', 'ADMIN', 'a', NULL, NULL);
    `);
    const db = new SqliteDatabaseClient(sqlite);
    const storage = { put: async () => {}, get: async () => null, delete: async () => {}, getUrl: (key: string) => `/api/v1/assets/raw/${key}` };
    const app = createApp(db, storage as any);
    const env = { JWT_SECRET: 'favorites-isolated-test-secret-over-32-characters', _dbClient: db, _storageDriver: storage };
    const tokenA = await createJwt({ userId: 'a', username: 'fav_a', role: 'USER' }, env.JWT_SECRET);
    const tokenB = await createJwt({ userId: 'b', username: 'fav_b', role: 'USER' }, env.JWT_SECRET);
    const call = (method: string, route: string, token: string | null, body?: unknown) => app.fetch(new Request(`http://localhost/api/v1/me/${route}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env as any);
    const post = async (body: object, token = tokenA) => {
      const response = await call('POST', 'favorites', token, body);
      return { status: response.status, json: await response.json() as any };
    };
    const list = async (token = tokenA): Promise<FavoriteGameItem[]> => {
      const response = await call('GET', 'favorites', token);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('Cache-Control') || '', /private, no-store/);
      return (await response.json() as any).data;
    };
    const rows = () => sqlite.prepare("SELECT count(*) AS n FROM user_game_activity WHERE activity_type = 'FAVORITE'").get() as { n: number };

    assert.equal((await call('GET', 'favorites', null)).status, 401);
    assert.equal((await call('POST', 'favorites', null, { game_id: 'g1', favorite: true })).status, 401);
    assert.deepEqual(await list(), []);
    console.log('PASS login required, private no-store list, empty to start');

    for (const body of [{}, { game_id: '' }, { game_id: 'g1', favorite: 'yes' }, { game_id: 'g1', favorite: 1 }, { game_id: 'hidden', favorite: true }, { game_id: 'missing', favorite: true }]) {
      assert.equal((await post(body)).status, 400, JSON.stringify(body));
    }
    assert.equal(rows().n, 0);
    console.log('PASS invalid bodies, non-boolean favorite and unpublished/missing games rejected');

    for (let i = 0; i < 2; i++) {
      const res = await post({ game_id: 'g1', favorite: true });
      assert.equal(res.status, 200);
      assert.deepEqual(res.json.data, { isFavorite: true });
    }
    assert.equal(rows().n, 1);
    assert.deepEqual((await post({ game_id: 'g2', favorite: true })).json.data, { isFavorite: true });
    let items = await list();
    assert.deepEqual(items.map(item => item.game_id).sort(), ['g1', 'g2']);
    const one = items.find(item => item.game_id === 'g1')!;
    assert.equal(one.game_name, 'Game One');
    assert.equal(one.game_slug, 'game-one');
    assert.equal(one.developer, 'Gameloft');
    assert.equal(one.category_name, 'Nhập vai');
    assert.equal(one.cover_url, '/api/v1/assets/raw/games/g1/cover.png');
    assert.ok(one.favorited_at);
    assert.equal(items.find(item => item.game_id === 'g2')!.cover_url, null, 'deleted cover must not be linked');
    assert.ok(!items.some(item => 'user_id' in item || 'cover_storage_key' in item), 'no internal columns leak');
    console.log('PASS favorite:true is idempotent; list has name, slug, developer, category and only active covers');

    assert.deepEqual(await list(tokenB), []);
    assert.deepEqual((await post({ game_id: 'g1', favorite: false }, tokenB)).json.data, { isFavorite: false });
    assert.equal((await list()).length, 2, 'user B cannot remove user A favorites');
    console.log('PASS favorites are per account');

    for (let i = 0; i < 2; i++) assert.deepEqual((await post({ game_id: 'g1', favorite: false })).json.data, { isFavorite: false });
    assert.deepEqual((await list()).map(item => item.game_id), ['g2']);
    console.log('PASS favorite:false is idempotent');

    assert.deepEqual((await post({ game_id: 'g1' })).json.data, { isFavorite: true });
    assert.deepEqual((await post({ game_id: 'g1' })).json.data, { isFavorite: false });
    console.log('PASS legacy toggle without "favorite" still flips');

    await post({ game_id: 'g1', favorite: true });
    assert.equal((await call('POST', 'history', tokenA, { game_id: 'g1', activity_type: 'PLAY' })).status, 200);
    const history: PlayHistoryItem[] = (await (await call('GET', 'history', tokenA)).json() as any).data;
    assert.deepEqual(history.map(item => [item.game_id, item.play_count]), [['g1', 1]]);
    assert.deepEqual((await list()).map(item => item.game_id).sort(), ['g1', 'g2'], 'playing does not change favorites');
    console.log('PASS favorites and play history stay separate');

    sqlite.prepare("UPDATE games SET status = 'DRAFT' WHERE id = 'g2'").run();
    assert.deepEqual((await list()).map(item => item.game_id), ['g1']);
    console.log('PASS a game that is no longer public drops out of the list');
  } finally {
    sqlite.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
