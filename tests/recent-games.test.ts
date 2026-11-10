import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createApp } from '../apps/api/src/index';
import { SqliteDatabaseClient } from '../apps/api/src/repositories/db';
import { runMigrations } from '../apps/api/src/repositories/migrationRunner';
import { createJwt } from '../packages/shared-utils/src/index';
import type { PlayHistoryItem } from '../packages/shared-types/src/index';

async function main() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  try {
    runMigrations(sqlite, path.resolve(__dirname, '../database/migrations'));
    sqlite.exec(`
      INSERT INTO users(id, username, email, password_hash) VALUES
        ('a', 'history_a', 'a@history.invalid', 'unused'), ('b', 'history_b', 'b@history.invalid', 'unused');
      INSERT INTO categories(id, name, slug) VALUES ('category', 'Trí tuệ', 'tri-tue');
      INSERT INTO games(id, name, slug, category_id, status, visibility, source_type, created_by) VALUES
        ('g1', 'Game One', 'game-one', 'category', 'PUBLISHED', 'PUBLIC', 'ADMIN', 'a'),
        ('g2', 'Game Two', 'game-two', 'category', 'PUBLISHED', 'PUBLIC', 'ADMIN', 'a'),
        ('hidden', 'Hidden Game', 'hidden-game', 'category', 'DRAFT', 'PRIVATE', 'ADMIN', 'a');
      INSERT INTO game_assets(id, owner_user_id, asset_type, storage_key, original_filename, mime_type, sha256) VALUES
        ('asset-a', 'a', 'JAR', 'users/a/private.jar', 'private.jar', 'application/java-archive', 'fixture-a'),
        ('asset-b', 'b', 'JAR', 'users/b/private.jar', 'private.jar', 'application/java-archive', 'fixture-b');
      INSERT INTO user_library(id, user_id, custom_name, source_type, custom_asset_id, game_id) VALUES
        ('import-a', 'a', 'Private A', 'IMPORT', 'asset-a', NULL),
        ('import-b', 'b', 'Private B', 'IMPORT', 'asset-b', NULL),
        ('catalog-a', 'a', 'Old catalog name', 'CATALOG', NULL, 'g1');
    `);
    const db = new SqliteDatabaseClient(sqlite);
    const storage = { put: async () => {}, get: async () => null, delete: async () => {}, getUrl: (key: string) => `/api/v1/assets/raw/${key}` };
    const app = createApp(db, storage);
    const env = { JWT_SECRET: 'recent-games-isolated-test-secret-over-32-characters', _dbClient: db, _storageDriver: storage };
    const tokenA = await createJwt({ userId: 'a', username: 'history_a', role: 'USER' }, env.JWT_SECRET);
    const tokenB = await createJwt({ userId: 'b', username: 'history_b', role: 'USER' }, env.JWT_SECRET);
    const request = (method: string, route = '', token: string | null = tokenA, body?: unknown) => app.fetch(new Request(`http://localhost/api/v1/me/history${route}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env as any);
    const play = (body: object, token = tokenA) => request('POST', '', token, { activity_type: 'PLAY', ...body });
    const history = async (token = tokenA, query = ''): Promise<PlayHistoryItem[]> => {
      const response = await request('GET', query, token);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('Cache-Control') || '', /private, no-store/);
      return (await response.json() as any).data;
    };

    assert.equal((await request('GET', '', null)).status, 401);
    assert.equal((await request('POST', '', null, { game_id: 'g1', activity_type: 'PLAY' })).status, 401);
    assert.deepEqual(await history(), []);
    console.log('PASS authenticated history, private cache policy and truthful empty state');

    for (const body of [{}, { game_id: '' }, { game_id: 'g1', user_library_id: 'import-a' }, { game_id: 'g1', activity_type: 'FAVORITE' }, { game_id: 'hidden' }, { game_id: 'missing' }, { user_library_id: 'import-b' }]) {
      assert.equal((await play(body)).status, 400, JSON.stringify(body));
    }
    for (const limit of ['0', '-1', '51', '1.5', 'invalid', '']) assert.equal((await request('GET', `?limit=${limit}`)).status, 400);
    console.log('PASS invalid targets, unavailable games, foreign library references and invalid limits rejected');

    assert.equal((await play({ game_id: 'g1' })).status, 200);
    sqlite.prepare("UPDATE user_game_activity SET last_played_at='2020-01-01 00:00:00' WHERE game_id='g1'").run();
    assert.equal((await play({ game_id: 'g2' })).status, 200);
    assert.deepEqual((await history()).map(item => item.game_id), ['g2', 'g1']);
    sqlite.prepare("UPDATE user_game_activity SET last_played_at='2021-01-01 00:00:00' WHERE game_id='g2'").run();
    assert.equal((await play({ game_id: 'g1' })).status, 200);
    let items = await history();
    assert.deepEqual(items.map(item => item.game_id), ['g1', 'g2']);
    assert.equal(items[0].play_count, 2);
    assert.match(items[0].last_played_at, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    assert.equal(items[0].game_slug, 'game-one');
    assert.equal(items[0].category_name, 'Trí tuệ');
    assert.ok(!('cover_storage_key' in items[0]));
    assert.equal((await history(tokenA, '?limit=1')).length, 1);
    assert.deepEqual(await history(tokenB), []);
    console.log('PASS newest-first order, replay promotion without duplicate cards, typed metadata and account isolation');

    assert.equal((await play({ user_library_id: 'import-a' })).status, 200);
    assert.equal((await play({ user_library_id: 'import-b' }, tokenB)).status, 200);
    assert.equal((await history()).find(item => item.user_library_id === 'import-a')?.custom_name, 'Private A');
    assert.deepEqual((await history(tokenB)).map(item => item.custom_name), ['Private B']);
    assert.ok(!(await history()).some(item => item.custom_name === 'Private B'));
    assert.equal((await play({ user_library_id: 'catalog-a' })).status, 200);
    assert.equal((await history()).filter(item => item.game_id === 'g1').length, 1);
    console.log('PASS private import history and catalog/library launch normalization');

    const insertActivity = sqlite.prepare("INSERT INTO user_game_activity(id,user_id,game_id,user_library_id,activity_type,last_played_at,play_count) VALUES(?,?,?,?,?,?,?)");
    insertActivity.run('old-duplicate', 'a', 'g1', null, 'PLAY', '2019-01-01 00:00:00', 1);
    insertActivity.run('old-catalog-library', 'a', null, 'catalog-a', 'PLAY', '2022-01-01 00:00:00', 1);
    insertActivity.run('old-favorite', 'a', 'g2', null, 'FAVORITE', '2090-01-01 00:00:00', 1);
    insertActivity.run('old-foreign-library', 'a', null, 'import-b', 'PLAY', '2090-01-01 00:00:00', 1);
    insertActivity.run('old-hidden', 'a', 'hidden', null, 'PLAY', '2090-01-01 00:00:00', 1);
    items = await history();
    assert.equal(items.length, 3);
    assert.equal(items.filter(item => item.game_id === 'g1').length, 1);
    assert.equal(items.find(item => item.game_id === 'g1')?.play_count, 5);
    assert.ok(items.every(item => item.activity_type === 'PLAY' && item.user_library_id !== 'import-b' && item.game_id !== 'hidden'));
    console.log('PASS legacy duplicates merged, mixed timestamp formats sorted and invalid historical references hidden');

    sqlite.prepare("UPDATE games SET status='DRAFT' WHERE id='g1'").run();
    assert.ok(!(await history()).some(item => item.game_id === 'g1'));
    assert.equal((await play({ user_library_id: 'catalog-a' })).status, 400);
    sqlite.prepare("UPDATE game_assets SET status='QUARANTINED' WHERE id='asset-a'").run();
    assert.ok(!(await history()).some(item => item.user_library_id === 'import-a'));
    assert.equal((await play({ user_library_id: 'import-a' })).status, 400);
    sqlite.prepare("UPDATE game_assets SET status='ACTIVE', owner_user_id='b' WHERE id='asset-a'").run();
    assert.ok(!(await history()).some(item => item.user_library_id === 'import-a'));
    assert.equal((await play({ user_library_id: 'import-a' })).status, 400);
    sqlite.prepare("UPDATE game_assets SET owner_user_id='a', storage_key='users/b/misplaced.jar' WHERE id='asset-a'").run();
    assert.ok(!(await history()).some(item => item.user_library_id === 'import-a'));
    assert.equal((await play({ user_library_id: 'import-a' })).status, 400);
    sqlite.prepare("UPDATE game_assets SET storage_key='users/a/private.jar', asset_type='COVER' WHERE id='asset-a'").run();
    assert.ok(!(await history()).some(item => item.user_library_id === 'import-a'));
    assert.equal((await play({ user_library_id: 'import-a' })).status, 400);
    console.log('PASS removed catalog games, quarantined assets, foreign assets, wrong prefixes and non-JAR assets filtered');
  } finally {
    sqlite.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
