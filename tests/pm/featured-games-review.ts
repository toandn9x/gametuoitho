/**
 * Admin-curated featured collection acceptance checks.
 * Run: pnpm --filter @gametuoitho/api exec tsx ../../tests/pm/featured-games-review.ts
 * Database/storage are in memory. No real uploads, accounts, network or servers.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createApp } from '../../apps/api/src/index';
import { SqliteDatabaseClient } from '../../apps/api/src/repositories/db';
import { GameRepository } from '../../apps/api/src/repositories/gameRepository';
import { runMigrations } from '../../apps/api/src/repositories/migrationRunner';
import type { StorageDriver } from '../../apps/api/src/storage/storage';

const apiRequire = createRequire(path.resolve(__dirname, '../../apps/api/package.json'));
const Database = apiRequire('better-sqlite3');
const migrationsDir = path.resolve(__dirname, '../../database/migrations');
const migrations = readdirSync(migrationsDir).filter(name => name.endsWith('.sql')).sort()
  .map(name => ({ name, sql: readFileSync(path.join(migrationsDir, name), 'utf8') }));
const fixtureSecret = 'synthetic-featured-review-signing-key-only';

function fixtureToken(userId: string, role: 'USER' | 'ADMIN') {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ userId, role, tokenVersion: 0, iat: now, exp: now + 3600 })).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${createHmac('sha256', fixtureSecret).update(input).digest('base64url')}`;
}

function harness() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const migration of migrations) db.exec(migration.sql);
  for (const [id, role] of [['featured-admin', 'ADMIN'], ['featured-user', 'USER']]) {
    db.prepare('INSERT INTO users (id, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?)')
      .run(id, id, `${id}@fixture.invalid`, 'synthetic-unused-hash', role);
  }
  for (const id of ['category-a', 'category-b']) {
    db.prepare('INSERT INTO categories (id, name, slug) VALUES (?, ?, ?)').run(id, id, id);
  }
  const insert = db.prepare('INSERT INTO games (id, name, slug, category_id, status, visibility, is_featured, created_by, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const addGame = (id: string, featured: number, status = 'PUBLISHED', visibility = 'PUBLIC', category = 'category-a') => {
    insert.run(id, `Synthetic ${id}`, id, category, status, visibility, featured, 'featured-admin', status === 'PUBLISHED' ? '2020-01-01T00:00:00.000Z' : null);
  };
  addGame('public-a', 0);
  addGame('public-b', 1);
  addGame('public-c', 1, 'PUBLISHED', 'PUBLIC', 'category-b');
  addGame('draft', 1, 'DRAFT');
  addGame('hidden', 1, 'HIDDEN');
  addGame('archived', 1, 'ARCHIVED');
  addGame('private', 1, 'PUBLISHED', 'PRIVATE');
  addGame('draft-unstarred', 0, 'DRAFT');

  const storage: StorageDriver = {
    async put() { throw new Error('unexpected fixture storage write'); },
    async get() { return null; },
    async delete() { throw new Error('unexpected fixture storage delete'); },
    getUrl(key) { return `/api/v1/assets/raw/${encodeURIComponent(key)}`; },
  };
  const dbClient = new SqliteDatabaseClient(db);
  const app = createApp(dbClient, storage);
  const env = { JWT_SECRET: fixtureSecret, ENVIRONMENT: 'test', DB: null, BUCKET: null, _dbClient: dbClient, _storageDriver: storage };
  const request = (pathname: string, actor: 'anonymous' | 'admin' | 'user' = 'anonymous', options: RequestInit = {}) => {
    const headers = new Headers(options.headers);
    if (actor !== 'anonymous') headers.set('Authorization', `Bearer ${fixtureToken(`featured-${actor}`, actor === 'admin' ? 'ADMIN' : 'USER')}`);
    return app.fetch(new Request(`http://featured.fixture.invalid${pathname}`, { ...options, headers }), env);
  };
  const update = (id: string, body: unknown, actor: 'anonymous' | 'admin' | 'user' = 'admin') => request(`/api/v1/admin/games/${id}`, actor, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const list = async (query = '', actor: 'anonymous' | 'admin' | 'user' = 'anonymous') => {
    const response = await request(`/api/v1/games?sort=name${query ? `&${query}` : ''}`, actor);
    assert.equal(response.status, 200);
    return await response.json() as any;
  };
  return { db, dbClient, request, update, list };
}

type Harness = ReturnType<typeof harness>;
const tests: { name: string; run: (h: Harness) => Promise<void> }[] = [];
const test = (name: string, run: (h: Harness) => Promise<void>) => tests.push({ name, run });
const ids = (body: any) => body.data.map((game: any) => game.id).sort();

test('unfiltered public list is unchanged and flags are booleans', async h => {
  const result = await h.list();
  assert.deepEqual(ids(result), ['public-a', 'public-b', 'public-c']);
  assert.ok(result.data.every((game: any) => typeof game.is_featured === 'boolean'));
  assert.equal(result.data.find((game: any) => game.id === 'public-a').is_featured, false);
  assert.equal(result.data.find((game: any) => game.id === 'public-b').is_featured, true);
});
test('featured=true includes only public published curated games', async h => {
  const result = await h.list('featured=true');
  assert.deepEqual(ids(result), ['public-b', 'public-c']);
  assert.equal(result.pagination.total, 2);
  assert.ok(result.data.every((game: any) => game.is_featured === true));
});
test('featured=false explicitly filters uncurated games', async h => {
  const result = await h.list('featured=false');
  assert.deepEqual(ids(result), ['public-a']);
  assert.equal(result.pagination.total, 1);
  assert.ok(result.data.every((game: any) => game.is_featured === false));
});
test('featured pagination counts the filtered set', async h => {
  const result = await h.list('featured=true&limit=1&page=2');
  assert.deepEqual(ids(result), ['public-c']);
  assert.equal(result.pagination.total, 2);
  assert.equal(result.pagination.totalPages, 2);
});
test('featured composes with category and search filters', async h => {
  assert.deepEqual(ids(await h.list('featured=true&categorySlug=category-b')), ['public-c']);
  assert.deepEqual(ids(await h.list('featured=true&search=public-b')), ['public-b']);
  assert.deepEqual(ids(await h.list('featured=true&search=public-a')), []);
});
for (const actor of ['anonymous', 'user', 'admin'] as const) {
  test(`nonpublic featured games never leak to ${actor} through public list`, async h => {
    const result = await h.list('featured=true', actor);
    assert.deepEqual(ids(result), ['public-b', 'public-c']);
  });
}
for (const value of ['', '1', '0', 'TRUE', 'FALSE', 'yes', 'null', 'undefined', 'true,false']) {
  test(`invalid featured=${JSON.stringify(value)} is rejected`, async h => {
    const response = await h.request(`/api/v1/games?featured=${encodeURIComponent(value)}`);
    assert.equal(response.status, 400);
    const body = await response.json() as any;
    assert.equal(body.success, false);
    assert.equal(body.data, undefined);
  });
}
for (const query of ['featured=true&featured=false', 'featured=true&featured=true', 'featured=true&page=bad', 'featured=true&limit=0']) {
  test(`invalid combined query cannot broaden collection: ${query}`, async h => {
    assert.equal((await h.request(`/api/v1/games?${query}`)).status, 400);
  });
}
test('admin star/unstar persists integer 1/0 and returns booleans', async h => {
  const before = h.db.prepare('SELECT status, visibility, published_at FROM games WHERE id = ?').get('public-a');
  let response = await h.update('public-a', { is_featured: true });
  assert.equal(response.status, 200);
  assert.equal((await response.json() as any).data.is_featured, true);
  assert.deepEqual(h.db.prepare('SELECT is_featured, typeof(is_featured) AS kind FROM games WHERE id = ?').get('public-a'), { is_featured: 1, kind: 'integer' });
  assert.deepEqual(h.db.prepare('SELECT status, visibility, published_at FROM games WHERE id = ?').get('public-a'), before);
  assert.deepEqual(ids(await h.list('featured=true')), ['public-a', 'public-b', 'public-c']);
  response = await h.request('/api/v1/games/public-a');
  assert.equal((await response.json() as any).data.game.is_featured, true);
  assert.equal((await new GameRepository(h.dbClient).findById('public-a'))?.is_featured, true);
  response = await h.update('public-a', { is_featured: false });
  assert.equal(response.status, 200);
  assert.equal((await response.json() as any).data.is_featured, false);
  assert.deepEqual(h.db.prepare('SELECT is_featured, typeof(is_featured) AS kind FROM games WHERE id = ?').get('public-a'), { is_featured: 0, kind: 'integer' });
  assert.deepEqual(ids(await h.list('featured=true')), ['public-b', 'public-c']);
  assert.deepEqual(h.db.prepare('SELECT status, visibility, published_at FROM games WHERE id = ?').get('public-a'), before);
});
test('ordinary metadata update preserves a curated flag', async h => {
  assert.equal((await h.update('public-b', { name: 'Renamed synthetic fixture' })).status, 200);
  assert.equal(h.db.prepare('SELECT is_featured FROM games WHERE id = ?').get('public-b').is_featured, 1);
  assert.equal((await h.request('/api/v1/games/public-b').then(r => r.json()) as any).data.game.is_featured, true);
});
test('hiding a curated game removes it from the public collection without clearing the flag', async h => {
  const response = await h.request('/api/v1/admin/games/public-b/hide', 'admin', { method: 'POST' });
  assert.equal(response.status, 200);
  assert.deepEqual(ids(await h.list('featured=true')), ['public-c']);
  assert.deepEqual(h.db.prepare('SELECT status, is_featured FROM games WHERE id = ?').get('public-b'), { status: 'HIDDEN', is_featured: 1 });
});
for (const id of ['draft-unstarred', 'private', 'hidden', 'archived']) {
  test(`starring ${id} never publishes or changes visibility`, async h => {
    const before = h.db.prepare('SELECT status, visibility, published_at FROM games WHERE id = ?').get(id);
    assert.equal((await h.update(id, { is_featured: true })).status, 200);
    assert.deepEqual(h.db.prepare('SELECT status, visibility, published_at FROM games WHERE id = ?').get(id), before);
    assert.ok(!ids(await h.list('featured=true')).includes(id));
  });
}
for (const [actor, status] of [['anonymous', 401], ['user', 403]] as const) {
  test(`${actor} cannot curate a game`, async h => {
    assert.equal((await h.update('public-a', { is_featured: true }, actor)).status, status);
    assert.equal(h.db.prepare('SELECT is_featured FROM games WHERE id = ?').get('public-a').is_featured, 0);
  });
}
for (const value of ['true', 'false', 1, 0, null, [], {}]) {
  test(`admin flag rejects nonboolean ${JSON.stringify(value)}`, async h => {
    assert.equal((await h.update('public-a', { is_featured: value })).status, 400);
    assert.equal(h.db.prepare('SELECT is_featured FROM games WHERE id = ?').get('public-a').is_featured, 0);
  });
}
test('admin list, search and category game payloads expose boolean flags', async h => {
  for (const [url, actor] of [
    ['/api/v1/admin/games', 'admin'], ['/api/v1/search?q=public', 'anonymous'],
    ['/api/v1/categories/category-a/games', 'anonymous'],
  ] as const) {
    const response = await h.request(url, actor);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.ok(body.data.length > 0);
    assert.ok(body.data.every((game: any) => typeof game.is_featured === 'boolean'));
  }
});
for (const featured of [undefined, false, true]) {
  test(`new admin draft has persisted flag ${String(featured)}`, async h => {
    const response = await h.request('/api/v1/admin/games', 'admin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New synthetic fixture', slug: 'new-featured-fixture', category_id: 'category-a', is_featured: featured }),
    });
    assert.equal(response.status, 201);
    const game = (await response.json() as any).data;
    assert.equal(game.is_featured, featured ?? false);
    assert.equal(h.db.prepare('SELECT is_featured FROM games WHERE id = ?').get(game.id).is_featured, featured ? 1 : 0);
    assert.equal(game.status, 'DRAFT');
    assert.ok(!ids(await h.list('featured=true')).includes(game.id));
  });
}
test('personal favorites do not alter the curated collection and vice versa', async h => {
  const response = await h.request('/api/v1/me/favorites', 'user', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game_id: 'public-a' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(ids(await h.list('featured=true')), ['public-b', 'public-c']);
  assert.equal(h.db.prepare('SELECT is_featured FROM games WHERE id = ?').get('public-a').is_featured, 0);
  const count = h.db.prepare("SELECT count(*) AS total FROM user_game_activity WHERE activity_type = 'FAVORITE'").get().total;
  assert.equal((await h.update('public-c', { is_featured: false })).status, 200);
  assert.equal(h.db.prepare("SELECT count(*) AS total FROM user_game_activity WHERE activity_type = 'FAVORITE'").get().total, count);
});

async function migrationChecks() {
  const db = new Database(':memory:');
  try {
    db.exec(migrations.find(migration => migration.name === '0001_initial_schema.sql')!.sql);
    db.prepare('INSERT INTO categories (id, name, slug) VALUES (?, ?, ?)').run('legacy-category', 'Legacy fixture', 'legacy-category');
    db.prepare('INSERT INTO games (id, name, slug, category_id) VALUES (?, ?, ?, ?)').run('legacy-game', 'Legacy fixture', 'legacy-game', 'legacy-category');
    const legacyRepo = new GameRepository(new SqliteDatabaseClient(db));
    assert.equal((await legacyRepo.findById('legacy-game'))?.is_featured, false, 'old 0001-only fixtures remain readable');
    assert.equal((await legacyRepo.findGames({})).games[0].is_featured, false);
    const applied = runMigrations(db, migrationsDir);
    assert.ok(applied.includes('0005_game_featured.sql'));
    assert.deepEqual(db.prepare('SELECT name, is_featured FROM games WHERE id = ?').get('legacy-game'), { name: 'Legacy fixture', is_featured: 0 });
    db.prepare('UPDATE games SET is_featured = 1 WHERE id = ?').run('legacy-game');
    assert.deepEqual(runMigrations(db, migrationsDir), [], 'tracked migration rerun must be a no-op');
    assert.equal(db.prepare('SELECT is_featured FROM games WHERE id = ?').get('legacy-game').is_featured, 1);
    assert.throws(() => db.prepare('UPDATE games SET is_featured = 2 WHERE id = ?').run('legacy-game'), /CHECK/);
    assert.throws(() => db.prepare('UPDATE games SET is_featured = NULL WHERE id = ?').run('legacy-game'), /NOT NULL/);
    db.prepare('INSERT INTO games (id, name, slug, category_id) VALUES (?, ?, ?, ?)').run('default-game', 'Default fixture', 'default-game', 'legacy-category');
    assert.equal(db.prepare('SELECT is_featured FROM games WHERE id = ?').get('default-game').is_featured, 0);
  } finally {
    db.close();
  }
}

async function main() {
  let passed = 0;
  let failed = 0;
  for (const item of tests) {
    const h = harness();
    try {
      await item.run(h);
      passed += 1;
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${item.name}: ${error instanceof Error ? error.message : String(error)}`);
    } finally { h.db.close(); }
  }
  try { await migrationChecks(); passed += 1; }
  catch (error) { failed += 1; console.error('FAIL legacy/incremental/repeat migration:', error instanceof Error ? error.message : String(error)); }
  console.log(`PM featured games: ${passed + failed} checks; ${passed} passed; ${failed} failed. In-memory fixtures only.`);
  if (failed) process.exitCode = 1;
}
main().catch(error => { console.error('PM featured harness failed:', error); process.exitCode = 1; });
