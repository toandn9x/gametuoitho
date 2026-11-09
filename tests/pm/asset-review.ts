/**
 * Independent R01-A/B acceptance checks. All bytes are synthetic fixtures, not
 * executable games. This file never starts a server or uses real uploads.
 * Run from the repository root:
 * pnpm --filter @gametuoitho/api exec tsx ../../tests/pm/asset-review.ts
 */
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createApp } from '../../apps/api/src/index';
import { SqliteDatabaseClient } from '../../apps/api/src/repositories/db';
import type { StorageDriver } from '../../apps/api/src/storage/storage';

const apiRequire = createRequire(path.resolve(__dirname, '../../apps/api/package.json'));
const Database = apiRequire('better-sqlite3');
const migration = readFileSync(
  path.resolve(__dirname, '../../database/migrations/0001_initial_schema.sql'),
  'utf8',
);
const fixtureSecret = 'synthetic-pm-fixture-signing-key-only';

type Asset = { id: string; key: string; bytes: Uint8Array; contentType: string };
type Actor = 'anonymous' | 'owner' | 'other' | 'admin' | 'demotedAdmin' | 'blockedAdmin' | 'blockedOwner' | 'deletedUser';
const actors: Record<Exclude<Actor, 'anonymous'>, { id: string; role: string; dbRole: string; status: string }> = {
  owner: { id: 'pm-owner', role: 'USER', dbRole: 'USER', status: 'ACTIVE' },
  other: { id: 'pm-other', role: 'USER', dbRole: 'USER', status: 'ACTIVE' },
  admin: { id: 'pm-admin', role: 'ADMIN', dbRole: 'ADMIN', status: 'ACTIVE' },
  demotedAdmin: { id: 'pm-demoted', role: 'ADMIN', dbRole: 'USER', status: 'ACTIVE' },
  blockedAdmin: { id: 'pm-blocked-admin', role: 'ADMIN', dbRole: 'ADMIN', status: 'BLOCKED' },
  blockedOwner: { id: 'pm-blocked-owner', role: 'USER', dbRole: 'USER', status: 'BLOCKED' },
  deletedUser: { id: 'pm-deleted-user', role: 'ADMIN', dbRole: 'ADMIN', status: 'ACTIVE' },
};

// An independent standard HS256 signer; no application auth helper is used.
function fixtureJwt(actor: Exclude<Actor, 'anonymous'>): string {
  const user = actors[actor];
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    userId: user.id, username: user.id, email: `${user.id}@fixture.invalid`,
    role: user.role, iat: now, exp: now + 3600,
  })).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${createHmac('sha256', fixtureSecret).update(input).digest('base64url')}`;
}

class MemoryStorage implements StorageDriver {
  objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  reads: string[] = [];
  async put(key: string, data: Uint8Array | ArrayBuffer, contentType: string) {
    this.objects.set(key, { bytes: new Uint8Array(data).slice(), contentType });
  }
  async get(key: string) {
    this.reads.push(key);
    const object = this.objects.get(key);
    return object ? { data: object.bytes.slice().buffer as ArrayBuffer, contentType: object.contentType } : null;
  }
  async delete(key: string) { this.objects.delete(key); }
  getUrl(key: string) { return `/api/v1/assets/raw/${encodeURIComponent(key)}`; }
}

function makeHarness() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(migration);
  for (const [name, user] of Object.entries(actors)) {
    if (name === 'deletedUser') continue;
    db.prepare('INSERT INTO users (id, username, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)')
      .run(user.id, user.id, `${user.id}@fixture.invalid`, 'synthetic-unused-hash', user.dbRole, user.status);
  }
  db.prepare('INSERT INTO categories (id, name, slug) VALUES (?, ?, ?)')
    .run('pm-category', 'Synthetic fixture category', 'pm-fixture');
  const storage = new MemoryStorage();
  const asset = (
    id: string, key: string, owner = actors.admin.id, status = 'ACTIVE', type = 'JAR',
    contentType = type === 'JAD' ? 'text/vnd.sun.j2me.app-descriptor' : type === 'JAR' ? 'application/java-archive' : 'image/png',
  ): Asset => {
    const bytes = new Uint8Array(Buffer.from(`PM SYNTHETIC FIXTURE ONLY [${id}] 0123456789abcdef`));
    db.prepare('INSERT INTO game_assets (id, owner_user_id, asset_type, storage_key, original_filename, mime_type, file_size, sha256, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, owner, type, key, `${id}.fixture`, contentType, bytes.length, createHash('sha256').update(bytes).digest('hex'), status);
    storage.objects.set(key, { bytes, contentType });
    return { id, key, bytes, contentType };
  };
  const privateAsset = asset('pm-private', 'users/pm-owner/imports/pm-private/game.jar', actors.owner.id);
  const blockedOwnerAsset = asset('pm-blocked-private', 'users/pm-blocked-owner/imports/pm-private/game.jar', actors.blockedOwner.id);
  const detachedCatalog = asset('pm-detached', 'games/pm-detached/versions/pm-detached/game.jar');
  const misleadingPrefix = asset('pm-misleading-prefix', 'games/pm-misleading/versions/pm-misleading/game.jar', actors.owner.id);
  const hostileMime = asset('pm-hostile-mime', 'users/pm-owner/imports/pm-hostile/game.jar', actors.owner.id, 'ACTIVE', 'JAR', 'text/html');
  const missingObject = asset('pm-missing-object', 'users/pm-owner/imports/pm-missing/game.jar', actors.owner.id);
  storage.objects.delete(missingObject.key);
  const orphan: Asset = { id: 'pm-orphan', key: 'users/pm-owner/imports/pm-orphan/game.jar', bytes: new Uint8Array(Buffer.from('PM SYNTHETIC ORPHAN ONLY')), contentType: 'application/java-archive' };
  storage.objects.set(orphan.key, { bytes: orphan.bytes, contentType: orphan.contentType });

  type GameFixture = { id: string; slug: string; versionId: string; jar: Asset; jad?: Asset };
  const games = new Map<string, GameFixture>();
  const game = (name: string, options: {
    status?: string; visibility?: string; versionStatus?: string; jarStatus?: string;
    jadStatus?: string; jarType?: string; jadType?: string; noJad?: boolean; jar?: Asset;
  } = {}) => {
    const id = `pm-game-${name}`;
    const versionId = `pm-version-${name}`;
    db.prepare('INSERT INTO games (id, name, slug, category_id, status, visibility, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, `Synthetic ${name}`, id, 'pm-category', options.status ?? 'PUBLISHED', options.visibility ?? 'PUBLIC', actors.admin.id);
    const jar = options.jar ?? asset(`pm-jar-${name}`, `games/${id}/versions/${versionId}/game.jar`, actors.admin.id, options.jarStatus ?? 'ACTIVE', options.jarType ?? 'JAR');
    const jad = options.noJad ? undefined : asset(`pm-jad-${name}`, `games/${id}/versions/${versionId}/game.jad`, actors.admin.id, options.jadStatus ?? 'ACTIVE', options.jadType ?? 'JAD');
    db.prepare('INSERT INTO game_versions (id, game_id, version_name, jar_asset_id, jad_asset_id, jar_sha256, file_size, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(versionId, id, 'Synthetic fixture v1', jar.id, jad?.id ?? null, createHash('sha256').update(jar.bytes).digest('hex'), jar.bytes.length, options.versionStatus ?? 'ACTIVE');
    const result = { id, slug: id, versionId, jar, jad };
    games.set(name, result);
    return result;
  };
  const publicGame = game('public');
  game('public-no-jad', { noJad: true });
  for (const status of ['DRAFT', 'HIDDEN', 'ARCHIVED']) game(status.toLowerCase(), { status });
  game('private', { visibility: 'PRIVATE' });
  game('inactive-version', { versionStatus: 'INACTIVE' });
  for (const state of ['UPLOADING', 'QUARANTINED', 'DELETED']) {
    game(`${state.toLowerCase()}-jar`, { jarStatus: state });
    game(`${state.toLowerCase()}-jad`, { jadStatus: state });
  }
  game('wrong-jar-type', { jarType: 'COVER' });
  game('wrong-jad-type', { jadType: 'COVER' });
  game('private-import-reference', { jar: privateAsset });
  const cover = asset('pm-public-cover', 'games/pm-game-public/covers/cover.png', actors.admin.id, 'ACTIVE', 'COVER');
  db.prepare('UPDATE games SET cover_asset_id = ? WHERE id = ?').run(cover.id, publicGame.id);
  const screenshot = asset('pm-public-shot', 'games/pm-game-public/screenshots/01.png', actors.admin.id, 'ACTIVE', 'SCREENSHOT');
  db.prepare('INSERT INTO game_screenshots (id, game_id, asset_id) VALUES (?, ?, ?)').run('pm-shot', publicGame.id, screenshot.id);

  const app = createApp(new SqliteDatabaseClient(db), storage);
  const env = { JWT_SECRET: fixtureSecret, ENVIRONMENT: 'test', DB: null, BUCKET: null };
  const actorTokens = new Map(Object.keys(actors).map(name => [name, fixtureJwt(name as Exclude<Actor, 'anonymous'>)]));
  const request = (pathname: string, actor: Actor = 'anonymous', options: RequestInit = {}) => {
    const headers = new Headers(options.headers);
    if (actor !== 'anonymous') headers.set('Authorization', `Bearer ${actorTokens.get(actor)}`);
    return app.fetch(new Request(`http://pm-fixture.invalid${pathname}`, { ...options, headers }), env);
  };
  return { db, storage, request, asset, game, games, privateAsset, blockedOwnerAsset, detachedCatalog, misleadingPrefix, hostileMime, missingObject, orphan, cover, screenshot };
}

type Harness = ReturnType<typeof makeHarness>;
const checks: { name: string; run: (h: Harness) => Promise<void> }[] = [];
function check(name: string, run: (h: Harness) => Promise<void>) { checks.push({ name, run }); }
function noStore(response: Response) {
  const cache = response.headers.get('cache-control') ?? '';
  assert.match(cache, /(?:^|,)\s*no-store\b/i, 'response must explicitly prohibit storage');
  assert.doesNotMatch(cache, /(?:^|,)\s*public\b/i, 'private/denied response must not be public');
}
function noStalePublicCache(response: Response) {
  const cache = response.headers.get('cache-control') ?? '';
  assert.match(cache, /(?:^|,)\s*(?:no-store|no-cache)\b/i, 'mutable publication must not be served from a stale cache');
  assert.doesNotMatch(cache, /(?:s-maxage|max-age)\s*=\s*[1-9]|\bimmutable\b/i);
}
async function denied(h: Harness, pathname: string, actor: Actor = 'anonymous', options: RequestInit = {}, forbiddenAsset?: Asset) {
  h.storage.reads.length = 0;
  const response = await h.request(pathname, actor, options);
  assert.ok([400, 401, 403, 404].includes(response.status), `expected denial before delivery, got ${response.status}`);
  assert.equal(response.headers.get('content-range'), null, 'denial must not disclose private byte size/range');
  noStore(response);
  const body = await response.text();
  assert.doesNotMatch(body, /PM SYNTHETIC/);
  if (forbiddenAsset) assert.ok(!body.includes(forbiddenAsset.key), 'denial must not disclose storage key');
  assert.deepEqual(h.storage.reads, [], 'authorization/metadata denial must occur before any object read');
}
async function delivered(h: Harness, asset: Asset, actor: Actor, method = 'GET') {
  const response = await h.request(h.storage.getUrl(asset.key), actor, { method });
  assert.equal(response.status, 200);
  assert.equal(Number(response.headers.get('content-length')), asset.bytes.length);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), method === 'HEAD' ? new Uint8Array() : asset.bytes);
  return response;
}

for (const actor of ['owner', 'admin'] as Actor[]) {
  for (const method of ['GET', 'HEAD']) check(`private ACTIVE ${actor} ${method}`, async h => {
    noStore(await delivered(h, h.privateAsset, actor, method));
  });
}
for (const actor of ['anonymous', 'other', 'demotedAdmin', 'blockedAdmin', 'blockedOwner', 'deletedUser'] as Actor[]) {
  for (const method of ['GET', 'HEAD']) check(`private denied ${actor} ${method}`, h => denied(h, h.storage.getUrl(h.privateAsset.key), actor, { method }, h.privateAsset));
  for (const range of ['bytes=0-3', 'bytes=999999-']) check(`private denied ${actor} ${range}`, h => denied(h, h.storage.getUrl(h.privateAsset.key), actor, { headers: { Range: range } }, h.privateAsset));
}
check('blocked owner cannot read their own ACTIVE import', h => denied(h, h.storage.getUrl(h.blockedOwnerAsset.key), 'blockedOwner', {}, h.blockedOwnerAsset));
check('owner blocked after token issuance loses private access', async h => {
  await delivered(h, h.privateAsset, 'owner');
  h.db.prepare("UPDATE users SET status = 'BLOCKED' WHERE id = ?").run(actors.owner.id);
  await denied(h, h.storage.getUrl(h.privateAsset.key), 'owner', {}, h.privateAsset);
});
check('admin demoted after token issuance loses other-owner access', async h => {
  await delivered(h, h.privateAsset, 'admin');
  h.db.prepare("UPDATE users SET role = 'USER' WHERE id = ?").run(actors.admin.id);
  await denied(h, h.storage.getUrl(h.privateAsset.key), 'admin', {}, h.privateAsset);
});

for (const state of ['UPLOADING', 'QUARANTINED', 'DELETED']) {
  for (const actor of ['anonymous', 'owner', 'other', 'admin', 'demotedAdmin', 'blockedAdmin'] as Actor[]) {
    for (const method of ['GET', 'HEAD', 'RANGE']) check(`${state} denied ${actor} ${method}`, async h => {
      h.db.prepare('UPDATE game_assets SET status = ? WHERE id = ?').run(state, h.privateAsset.id);
      await denied(h, h.storage.getUrl(h.privateAsset.key), actor, method === 'RANGE' ? { headers: { Range: 'bytes=0-3' } } : { method }, h.privateAsset);
    });
  }
}
for (const fixture of ['orphan', 'detachedCatalog', 'misleadingPrefix'] as const) {
  for (const actor of ['anonymous', 'other'] as Actor[]) {
    for (const method of ['GET', 'HEAD', 'RANGE']) check(`${fixture} not public ${actor} ${method}`, h => {
      const asset = h[fixture];
      return denied(h, h.storage.getUrl(asset.key), actor, method === 'RANGE' ? { headers: { Range: 'bytes=0-3' } } : { method }, asset);
    });
  }
}
check('orphan is denied even to admin without reading object', h => denied(h, h.storage.getUrl(h.orphan.key), 'admin', {}, h.orphan));
check('missing authorized object returns 404 without fixture bytes', async h => {
  const response = await h.request(h.storage.getUrl(h.missingObject.key), 'owner');
  assert.equal(response.status, 404);
  noStore(response);
  assert.doesNotMatch(await response.text(), /PM SYNTHETIC/);
});
for (const method of ['GET', 'HEAD', 'RANGE']) check(`unknown metadata denied ${method}`, h => denied(h, '/api/v1/assets/raw/pm-nonexistent', 'admin', method === 'RANGE' ? { headers: { Range: 'bytes=0-3' } } : { method }));

for (const fixture of ['jar', 'jad', 'cover', 'screenshot'] as const) {
  for (const actor of ['anonymous', 'owner', 'other', 'admin'] as Actor[]) {
    for (const method of ['GET', 'HEAD']) check(`public ${fixture} ${actor} ${method}`, async h => {
      const game = h.games.get('public')!;
      const asset = fixture === 'jar' ? game.jar : fixture === 'jad' ? game.jad! : h[fixture];
      const response = await delivered(h, asset, actor, method);
      noStalePublicCache(response);
      if (fixture === 'cover' || fixture === 'screenshot') assert.match(response.headers.get('content-type') ?? '', /^image\/png\b/i);
    });
  }
}
for (const fixture of ['cover', 'screenshot'] as const) {
  for (const state of ['UPLOADING', 'QUARANTINED', 'DELETED']) {
    for (const method of ['GET', 'HEAD', 'RANGE']) check(`public ${fixture} ${state} denied ${method}`, async h => {
      const asset = h[fixture];
      h.db.prepare('UPDATE game_assets SET status = ? WHERE id = ?').run(state, asset.id);
      await denied(h, h.storage.getUrl(asset.key), 'anonymous', method === 'RANGE' ? { headers: { Range: 'bytes=0-3' } } : { method }, asset);
    });
  }
}

const inaccessibleGames = ['draft', 'hidden', 'archived', 'private'];
for (const name of inaccessibleGames) {
  for (const method of ['GET', 'HEAD', 'RANGE']) check(`Catalog ${name} raw denied ${method}`, h => denied(h, h.storage.getUrl(h.games.get(name)!.jar.key), 'anonymous', method === 'RANGE' ? { headers: { Range: 'bytes=0-3' } } : { method }, h.games.get(name)!.jar));
  for (const actor of ['anonymous', 'owner', 'admin'] as Actor[]) {
    for (const endpoint of ['versions', 'detail'] as const) check(`public API ${name} ${endpoint} ${actor} is 404`, async h => {
      const game = h.games.get(name)!;
      const response = await h.request(endpoint === 'versions' ? `/api/v1/games/${game.id}/versions` : `/api/v1/games/${game.slug}`, actor);
      assert.equal(response.status, 404, 'admin preview must not relax the public API');
      const body = await response.text();
      assert.ok(!body.includes(game.jar.key));
      assert.ok(!body.includes(game.versionId));
    });
  }
}
check('nonexistent parent versions is 404', async h => {
  const response = await h.request('/api/v1/games/pm-game-does-not-exist/versions');
  assert.equal(response.status, 404);
});

const ineligibleVersions = [
  'inactive-version', 'uploading-jar', 'quarantined-jar', 'deleted-jar',
  'uploading-jad', 'quarantined-jad', 'deleted-jad', 'wrong-jar-type',
  'wrong-jad-type', 'private-import-reference',
];
for (const name of ineligibleVersions) {
  for (const endpoint of ['versions', 'detail'] as const) check(`public API excludes ${name} ${endpoint}`, async h => {
    const game = h.games.get(name)!;
    const response = await h.request(endpoint === 'versions' ? `/api/v1/games/${game.id}/versions` : `/api/v1/games/${game.slug}`);
    assert.ok([200, 404].includes(response.status));
    const body = await response.json() as any;
    if (response.status === 200) {
      const versions = endpoint === 'versions' ? body.data : body.data?.versions;
      assert.ok(Array.isArray(versions));
      assert.equal(versions.length, 0, 'no ineligible version or file URL may be exposed');
    } else assert.ok(!JSON.stringify(body).includes(game.versionId));
  });
  check(`raw excludes ineligible public version ${name}`, h => denied(h, h.storage.getUrl(h.games.get(name)!.jar.key), 'anonymous', {}, h.games.get(name)!.jar));
  check(`raw JAD excludes ineligible public version ${name}`, h => denied(h, h.storage.getUrl(h.games.get(name)!.jad!.key), 'anonymous', {}, h.games.get(name)!.jad));
}
for (const name of ['public', 'public-no-jad']) {
  for (const endpoint of ['versions', 'detail'] as const) check(`eligible ${name} ${endpoint} remains usable`, async h => {
    const game = h.games.get(name)!;
    const response = await h.request(endpoint === 'versions' ? `/api/v1/games/${game.id}/versions` : `/api/v1/games/${game.slug}`);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    const versions = endpoint === 'versions' ? body.data : body.data?.versions;
    assert.ok(Array.isArray(versions));
    assert.deepEqual(versions.map((v: any) => v.id), [game.versionId]);
    assert.ok(versions[0].jar_url, 'eligible version still needs a usable URL');
  });
}

const validRanges = [
  { value: 'bytes=0-0', start: 0, end: 0 },
  { value: 'bytes=2-8', start: 2, end: 8 },
  { value: 'bytes=3-', start: 3, end: undefined },
  { value: 'bytes=-7', start: -7, end: undefined },
  { value: 'bytes=-999999', start: 0, end: undefined },
  { value: 'bytes=0-999999', start: 0, end: undefined },
];
for (const actor of ['anonymous', 'owner'] as Actor[]) {
  for (const range of validRanges) check(`valid range ${actor} ${range.value}`, async h => {
    const asset = actor === 'anonymous' ? h.games.get('public')!.jar : h.privateAsset;
    const size = asset.bytes.length;
    const start = range.start < 0 ? size + range.start : range.start;
    const end = range.end ?? size - 1;
    const response = await h.request(h.storage.getUrl(asset.key), actor, { headers: { Range: range.value } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${size}`);
    assert.equal(Number(response.headers.get('content-length')), end - start + 1);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), asset.bytes.slice(start, end + 1));
    actor === 'anonymous' ? noStalePublicCache(response) : noStore(response);
  });
  for (const range of ['bytes=999999-', 'bytes=9-3', 'bytes=-0']) check(`unsatisfiable range ${actor} ${range}`, async h => {
    const asset = actor === 'anonymous' ? h.games.get('public')!.jar : h.privateAsset;
    const response = await h.request(h.storage.getUrl(asset.key), actor, { headers: { Range: range } });
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), `bytes */${asset.bytes.length}`);
    actor === 'anonymous' ? noStalePublicCache(response) : noStore(response);
  });
  for (const range of ['bytes=not-a-number', 'bytes=a-b', 'bytes=0-foo', 'bytes=-', 'bytes=0-1,4-5']) check(`malformed or multiple range ${actor} ${range}`, async h => {
    const asset = actor === 'anonymous' ? h.games.get('public')!.jar : h.privateAsset;
    const response = await h.request(h.storage.getUrl(asset.key), actor, { headers: { Range: range } });
    const contentRange = response.headers.get('content-range') ?? '';
    assert.doesNotMatch(contentRange, /NaN|undefined|Infinity/);
    const multipart = response.status === 206 && /^multipart\/byteranges\b/i.test(response.headers.get('content-type') ?? '');
    assert.ok([200, 400, 416].includes(response.status) || multipart, `unsupported range must be rejected or ignored consistently, got ${response.status}`);
    if (response.status === 200) assert.deepEqual(new Uint8Array(await response.arrayBuffer()), asset.bytes);
    if (response.status === 416) assert.equal(contentRange, `bytes */${asset.bytes.length}`);
    actor === 'anonymous' ? noStalePublicCache(response) : noStore(response);
  });
}
for (const actor of ['anonymous', 'owner', 'admin'] as Actor[]) check(`HEAD with Range preserves policy ${actor}`, async h => {
  const asset = actor === 'anonymous' ? h.games.get('public')!.jar : h.privateAsset;
  const response = await h.request(h.storage.getUrl(asset.key), actor, { method: 'HEAD', headers: { Range: 'bytes=0-3' } });
  assert.ok([200, 206].includes(response.status));
  assert.equal((await response.arrayBuffer()).byteLength, 0);
  assert.equal(Number(response.headers.get('content-length')), response.status === 200 ? asset.bytes.length : 4);
  assert.equal(response.headers.get('content-range'), response.status === 200 ? null : `bytes 0-3/${asset.bytes.length}`);
  actor === 'anonymous' ? noStalePublicCache(response) : noStore(response);
});
for (const actor of ['anonymous', 'other', 'demotedAdmin', 'blockedAdmin'] as Actor[]) check(`private denied ${actor} HEAD with Range`, h => denied(h, h.storage.getUrl(h.privateAsset.key), actor, { method: 'HEAD', headers: { Range: 'bytes=0-3' } }, h.privateAsset));

for (const method of ['GET', 'HEAD', 'RANGE']) check(`old public URL revoked after hide ${method}`, async h => {
  const game = h.games.get('public')!;
  await delivered(h, game.jar, 'anonymous');
  h.db.prepare("UPDATE games SET status = 'HIDDEN' WHERE id = ?").run(game.id);
  await denied(h, h.storage.getUrl(game.jar.key), 'anonymous', method === 'RANGE' ? { headers: { Range: 'bytes=0-3' } } : { method }, game.jar);
});
for (const actor of ['anonymous', 'owner', 'admin'] as Actor[]) check(`old URL revoked after quarantine ${actor}`, async h => {
  const asset = actor === 'anonymous' ? h.games.get('public')!.jar : h.privateAsset;
  await delivered(h, asset, actor);
  h.db.prepare("UPDATE game_assets SET status = 'QUARANTINED' WHERE id = ?").run(asset.id);
  await denied(h, h.storage.getUrl(asset.key), actor, {}, asset);
});
for (const transition of ['hide', 'quarantine'] as const) {
  for (const endpoint of ['versions', 'detail'] as const) check(`public API revokes ${endpoint} after ${transition}`, async h => {
    const game = h.games.get('public')!;
    const url = endpoint === 'versions' ? `/api/v1/games/${game.id}/versions` : `/api/v1/games/${game.slug}`;
    assert.equal((await h.request(url)).status, 200);
    if (transition === 'hide') h.db.prepare("UPDATE games SET status = 'HIDDEN' WHERE id = ?").run(game.id);
    else h.db.prepare("UPDATE game_assets SET status = 'QUARANTINED' WHERE id = ?").run(game.jar.id);
    const response = await h.request(url);
    if (transition === 'hide') assert.equal(response.status, 404);
    else {
      assert.ok([200, 404].includes(response.status));
      const body = await response.json() as any;
      if (response.status === 200) assert.deepEqual(endpoint === 'versions' ? body.data : body.data?.versions, []);
    }
  });
}

for (const key of ['../outside.fixture', '..\\outside.fixture', '/outside.fixture', 'C:\\outside\\fixture.jar', 'games//alias.jar', 'games/./alias.jar', 'games/a/../alias.jar']) {
  check(`invalid key rejected without storage read ${JSON.stringify(key)}`, h => denied(h, `/api/v1/assets/raw/${encodeURIComponent(key)}`, 'admin'));
}
check('double-encoded private key is rejected rather than aliased', h => denied(h, `/api/v1/assets/raw/${encodeURIComponent(encodeURIComponent(h.privateAsset.key))}`, 'owner', {}, h.privateAsset));
check('canonical encoded private key remains usable', async h => { noStore(await delivered(h, h.privateAsset, 'owner')); });
check('active MIME cannot turn a JAR data route into executable HTML', async h => {
  const response = await delivered(h, h.hostileMime, 'owner');
  noStore(response);
  assert.equal(response.headers.get('x-content-type-options')?.toLowerCase(), 'nosniff');
  const contentType = response.headers.get('content-type') ?? '';
  if (/text\/html|application\/xhtml\+xml|image\/svg\+xml/i.test(contentType)) {
    assert.match(response.headers.get('content-disposition') ?? '', /\battachment\b/i, 'active document MIME must be forced to download');
  }
});

async function main() {
  let passed = 0;
  const failures: { name: string; message: string }[] = [];
  for (const item of checks) {
    const h = makeHarness();
    try {
      await item.run(h);
      passed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ name: item.name, message });
      console.error(`FAIL ${item.name}: ${message}`);
    } finally {
      h.db.close();
    }
  }
  console.log(`PM R01-A/B: ${checks.length} checks; ${passed} passed; ${failures.length} failed. Synthetic fixtures; no network, real uploads or JAR execution.`);
  if (failures.length) process.exitCode = 1;
}

main().catch(error => {
  console.error('PM acceptance harness could not complete:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
