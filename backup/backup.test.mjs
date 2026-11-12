// Synthetic cloud only; never reads real settings, executes games or changes cloud data.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, createHmac } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, cp, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupPath, download, exportD1, loadSettings, parseArgs, parseList, readAssets, redact,
  runBackup, signS3, validateSettings, verifySnapshot } from './backup.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const enc = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const settings = validateSettings({
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), D1_DATABASE_ID: '12345678-1234-1234-1234-123456789abc',
  CLOUDFLARE_API_TOKEN: 'fixture-cf-secret', D1_DATABASE_NAME: 'fixture-d1',
  TIGRIS_BUCKET: 'fixture-bucket', TIGRIS_ACCESS_KEY_ID: 'fixture-s3-id',
  TIGRIS_SECRET_ACCESS_KEY: 'fixture-s3-secret',
});
const xmlEscape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
function listXml(objects, next) {
  return '<?xml version="1.0"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
    '<EncodingType>url</EncodingType><IsTruncated>' + Boolean(next) + '</IsTruncated>' +
    objects.map(object => '<Contents><Key>' + enc(object.key) + '</Key><Size>' + object.bytes.length +
      '</Size><ETag>' + xmlEscape(object.etag) + '</ETag><LastModified>2026-11-12T00:00:00Z</LastModified></Contents>').join('') +
    (next ? '<NextContinuationToken>' + xmlEscape(next) + '</NextContinuationToken>' : '') + '</ListBucketResult>';
}
function checkSignature(url, headers) {
  const authorization = headers.get('authorization');
  const match = authorization.match(/^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/);
  assert.ok(match, 'S3 authorization must be SigV4');
  const [, accessKey, date, region, signedHeaders, signature] = match;
  assert.equal(accessKey, settings.TIGRIS_ACCESS_KEY_ID); assert.equal(region, 'auto');
  const query = [...url.searchParams].map(([key, value]) => [enc(key), enc(value)]).sort(([a, av], [b, bv]) =>
    a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0).map(pair => pair.join('=')).join('&');
  const canonicalHeaders = signedHeaders.split(';').map(name => name + ':' +
    (name === 'host' ? url.host : headers.get(name)).trim().replace(/\s+/g, ' ') + '\n').join('');
  const canonical = ['GET', url.pathname.split('/').map(part => enc(decodeURIComponent(part))).join('/'), query,
    canonicalHeaders, signedHeaders, headers.get('x-amz-content-sha256')].join('\n');
  const scope = date + '/' + region + '/s3/aws4_request';
  const key = hmac(hmac(hmac(hmac('AWS4' + settings.TIGRIS_SECRET_ACCESS_KEY, date), region), 's3'), 'aws4_request');
  const expected = hmac(key, ['AWS4-HMAC-SHA256', headers.get('x-amz-date'), scope, hash(canonical)].join('\n')).toString('hex');
  assert.equal(signature, expected, 'independently reconstructed wire signature');
}
function cloudFixture(options = {}) {
  const objects = [
    { key: 'games/g1/versions/v1/game.jar', bytes: Buffer.from('PK-JAR-data-only'), etag: '"multipart-etag-2"' },
    { key: 'games/g1/covers/cover.png', bytes: Buffer.from('PNG-data-only'), etag: '"cover-etag"' },
    { key: 'games/g1/versions/v1/game.jad', bytes: Buffer.from('MIDlet-Name: Fixture'), etag: '"jad-etag"' },
    { key: 'users/u/imports/CON + & tiếng Việt/game.JAR', bytes: Buffer.from('PK-private-data-only'), etag: '"private-etag"' },
  ];
  const assets = objects.slice(0, 2).map((object, i) => ({ id: 'asset-' + i, asset_type: i ? 'COVER' : 'JAR',
    storage_key: object.key, original_filename: i ? 'cover.png' : 'Ninja fixture.jar',
    file_size: object.bytes.length, sha256: hash(object.bytes), status: 'ACTIVE' }));
  assets.push({ id: 'asset-9', asset_type: 'JAR', storage_key: 'quarantined/rejected', original_filename: 'bad.jar',
    file_size: 20, sha256: hash('bad'), status: 'QUARANTINED' }); // Intentionally never stored.
  const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
  const sql = 'PRAGMA defer_foreign_keys=TRUE;\nCREATE TABLE users(id TEXT PRIMARY KEY, username TEXT, password_hash TEXT);\n' +
    "INSERT INTO users VALUES ('u1','Fixture user','fixture-password-hash');\n" +
    'CREATE TABLE game_assets(id TEXT PRIMARY KEY, asset_type TEXT, storage_key TEXT, original_filename TEXT, file_size INTEGER, sha256 TEXT, status TEXT);\n' +
    assets.map(asset => 'INSERT INTO game_assets VALUES (' + Object.values(asset).map(quote).join(',') + ');').join('\n');
  const calls = [];
  let listPass = 0, queries = 0, exports = 0;
  const fetcher = async (input, init = {}) => {
    const url = new URL(input), headers = new Headers(init.headers);
    const method = init.method || 'GET', payload = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method, headers, payload });
    assert.equal(init.redirect, 'error');
    if (url.origin === 'https://api.cloudflare.com') {
      assert.equal(headers.get('authorization'), 'Bearer ' + settings.CLOUDFLARE_API_TOKEN);
      if (method === 'GET') return Response.json({ success: true, result: { name: 'fixture-d1' } });
      assert.equal(method, 'POST');
      if (url.pathname.endsWith('/query')) {
        assert.match(payload.sql, /^SELECT .* FROM game_assets WHERE id > \? ORDER BY id LIMIT \?$/);
        queries++;
        const rows = assets.filter(asset => asset.id > payload.params[0]).slice(0, payload.params[1]).map(asset => ({ ...asset }));
        if (options.changeAssets && queries > 1) rows[0].original_filename = 'changed.jar';
        return Response.json({ success: true, result: [{ success: true, results: rows }] });
      }
      assert.ok(url.pathname.endsWith('/export'));
      exports++;
      assert.deepEqual(payload.dump_options, { no_data: false, no_schema: false, compatibility: 'd1' });
      if (options.export403) return new Response('Never log ' + settings.CLOUDFLARE_API_TOKEN, { status: 403 });
      assert.equal(payload.output_format, 'polling');
      if (exports === 1) return Response.json({ success: true, result: { at_bookmark: 'fixture-bookmark', type: 'export' } });
      assert.equal(payload.current_bookmark, 'fixture-bookmark');
      return Response.json({ success: true, result: { status: 'complete', at_bookmark: 'fixture-bookmark',
        result: { signed_url: 'https://download.fixture/database.sql?X-Amz-Signature=fixture-signature' } } });
    }
    assert.equal(method, 'GET');
    if (url.hostname === 'download.fixture') {
      assert.equal(headers.has('authorization'), false, 'Cloudflare token cannot reach signed-download host');
      return new Response(sql);
    }
    assert.equal(url.origin, settings.TIGRIS_ENDPOINT);
    checkSignature(url, headers);
    if (url.searchParams.has('list-type')) {
      assert.equal(url.searchParams.get('encoding-type'), 'url');
      const next = url.searchParams.get('continuation-token');
      if (!next) listPass++;
      else assert.equal(next, '00009&+');
      const page = next ? objects.slice(2) : objects.slice(0, 2);
      const entries = options.changeBucket && listPass > 1 ? page.map(object => ({ ...object, etag: '"changed"' })) : page;
      return new Response(listXml(entries, next ? null : '00009&+'));
    }
    const key = url.pathname.split('/').slice(2).map(decodeURIComponent).join('/');
    const object = objects.find(item => item.key === key);
    assert.ok(object, 'unexpected object GET');
    assert.equal(headers.get('if-match'), object.etag);
    if (options.missing && key.endsWith('cover.png')) return new Response('Never log ' + settings.TIGRIS_SECRET_ACCESS_KEY, { status: 404 });
    const bytes = Buffer.from(object.bytes);
    if (options.badHash && key === objects[0].key) bytes[0] ^= 1;
    return new Response(bytes, { headers: { ETag: object.etag, 'Content-Length': String(bytes.length) } });
  };
  return { objects, assets, sql, calls, fetcher };
}
async function temporary(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gtt backup test '));
  const base = path.join(root, 'backup');
  await mkdir(base);
  try { return await run(base, root); }
  finally {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('gtt backup test '));
    await rm(resolved, { recursive: true, force: true });
  }
}

test('settings copy is scoped, portable and never executes dotenv or changes the original', () => temporary(async (base, root) => {
  const content = Object.entries(settings).map(([key, value]) => key + '=' + JSON.stringify(value)).join('\n') +
    '\nJWT_SECRET=do-not-copy-me\nEVIL=$(not-a-command)\n';
  const source = path.join(root, '.env.deploy.local');
  await writeFile(source, content);
  assert.deepEqual(await loadSettings(base), settings);
  assert.equal(await readFile(source, 'utf8'), content);
  const local = await readFile(path.join(base, '.env.backup.local'), 'utf8');
  assert.equal(local.includes('do-not-copy-me'), false); assert.equal(local.includes('EVIL'), false);
  await unlink(source);
  assert.deepEqual(await loadSettings(base), settings, 'works after project config is gone');
}));

test('XML parser handles namespaces/Unicode and rejects unsafe or malformed list responses', () => {
  const fixture = cloudFixture();
  const parsed = parseList(listXml(fixture.objects, '00009&+'));
  assert.equal(parsed.objects[3].key, fixture.objects[3].key); assert.equal(parsed.next, '00009&+');
  for (const xml of ['<bad>', listXml([], null).replace('false', 'yes'),
    '<!DOCTYPE x [<!ENTITY a SYSTEM "file:///C:/Windows/win.ini">]><ListBucketResult>&a;</ListBucketResult>',
    listXml([], 'next').replace('<NextContinuationToken>next</NextContinuationToken>', '')]) {
    assert.throws(() => parseList(xml));
  }
  for (const key of ['../game.jar', 'a/../../x', 'a\\b.jar', '/game.jar', 'a//b.jar']) assert.throws(() => backupPath(key));
  assert.match(backupPath(fixture.objects[3].key), /^game_jar\/[a-f0-9]{64}\.jar$/);
});

test('D1 asset pagination uses keyset SELECT only, including a final partial page', async () => {
  const fixture = cloudFixture();
  assert.deepEqual(await readAssets(settings, fixture.fetcher, 2), fixture.assets);
  assert.equal(fixture.calls.length, 2); assert.ok(fixture.calls.every(call => call.payload.sql.startsWith('SELECT ')));
});

test('--check performs read-only metadata/list requests, never export or object download', () => temporary(async base => {
  const fixture = cloudFixture();
  const result = await runBackup(base, settings, { check: true, fetcher: fixture.fetcher });
  assert.equal(result.checked, true); assert.equal(result.objects, 4);
  assert.equal(fixture.calls.some(call => call.url.pathname.endsWith('/export')), false);
  assert.equal(fixture.calls.some(call => call.url.hostname === 'download.fixture'), false);
  assert.deepEqual(await readdir(base), [], 'no snapshots/lock after check');
}));

test('full snapshot restores SQL locally, preserves bytes and verifies after copying outside project without credentials', () => temporary(async (base, root) => {
  const fixture = cloudFixture();
  const result = await runBackup(base, settings, { fetcher: fixture.fetcher, delay: async () => {} });
  assert.equal(result.manifest.status, 'complete'); assert.equal(result.manifest.files.length, 4);
  assert.equal(result.manifest.files.filter(file => file.file.startsWith('game_jar/')).length, 2);
  for (const record of result.manifest.files) {
    assert.deepEqual(await readFile(path.join(result.directory, record.file)), fixture.objects.find(object => object.key === record.key).bytes);
  }
  const db = new DatabaseSync(path.join(base, 'restored-test.sqlite'));
  try {
    db.exec(await readFile(path.join(result.directory, 'database.sql'), 'utf8'));
    assert.equal(db.prepare('SELECT username FROM users').get().username, 'Fixture user');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_assets').get().n, 3);
  } finally { db.close(); }
  const second = await runBackup(base, settings, { fetcher: cloudFixture().fetcher, delay: async () => {} });
  assert.notEqual(second.directory, result.directory);
  assert.equal((await verifySnapshot(result.directory)).status, 'complete', 'new run cannot overwrite the older snapshot');
  const portable = path.join(root, 'portable');
  await mkdir(portable);
  for (const filename of ['backup.mjs', 'parse-s3-list.ps1']) await cp(path.join(directory, filename), path.join(portable, filename));
  await cp(result.directory, path.join(portable, 'snapshot'), { recursive: true });
  const cli = spawnSync(process.execPath, [path.join(portable, 'backup.mjs'), '--verify', 'snapshot'], { cwd: root, encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(cli.status, 0, cli.stdout + cli.stderr); assert.match(cli.stdout, /VERIFY OK/);
  const manifests = await readFile(path.join(result.directory, 'manifest.json'), 'utf8');
  for (const key of ['CLOUDFLARE_API_TOKEN', 'TIGRIS_ACCESS_KEY_ID', 'TIGRIS_SECRET_ACCESS_KEY']) assert.equal(manifests.includes(settings[key]), false);
  const file = path.join(result.directory, result.manifest.files[0].file);
  await writeFile(file, 'corrupted');
  await assert.rejects(verifySnapshot(result.directory), /thieu\/hong/);
}));

for (const [name, options] of [
  ['missing object', { missing: true }], ['hash mismatch', { badHash: true }],
  ['changed bucket', { changeBucket: true }], ['changed database assets', { changeAssets: true }],
  ['export permission failure', { export403: true }],
]) test(name + ' cannot produce a complete backup; previous data retained', () => temporary(async base => {
  const fixture = cloudFixture(options), logs = [];
  await assert.rejects(runBackup(base, settings, { fetcher: fixture.fetcher, delay: async () => {}, log: line => logs.push(line) }));
  const snapshots = await readdir(path.join(base, 'snapshots'));
  assert.equal(snapshots.length, 1);
  const snapshot = path.join(base, 'snapshots', snapshots[0]);
  const manifest = JSON.parse(await readFile(path.join(snapshot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.status, 'incomplete');
  await assert.rejects(verifySnapshot(snapshot), /chua hoan tat/);
  if (!options.export403) assert.ok(manifest.files.length >= 3, 'healthy objects still downloaded');
  assert.equal((await readdir(base)).includes('.backup.lock'), false);
  for (const key of ['CLOUDFLARE_API_TOKEN', 'TIGRIS_SECRET_ACCESS_KEY']) assert.equal(logs.join('\n').includes(settings[key]), false);
}));

test('stale lock and manifest traversal fail closed', () => temporary(async base => {
  await writeFile(path.join(base, '.backup.lock'), 'a different operation');
  await assert.rejects(runBackup(base, settings, { fetcher: () => { throw new Error('must not connect'); } }), /backup\/check khac/);
  assert.equal(await readFile(path.join(base, '.backup.lock'), 'utf8'), 'a different operation');
  await unlink(path.join(base, '.backup.lock'));
  const result = await runBackup(base, settings, { fetcher: cloudFixture().fetcher, delay: async () => {} });
  result.manifest.database.file = '../../outside.sql';
  await writeFile(path.join(result.directory, 'manifest.json'), JSON.stringify(result.manifest));
  await assert.rejects(verifySnapshot(result.directory), /Manifest file/);
}));

test('bad export polling never restarts a new job or reveals upstream response', async () => {
  let calls = 0;
  await assert.rejects(exportD1(settings, async () => { calls++; return Response.json({ success: true, result: { at_bookmark: calls === 1 ? 'first' : 'different' } }); }, async () => {}), /bookmark/);
  assert.equal(calls, 2);
  const value = redact(Object.values(settings).join(' ') + ' https://host/file?X-Amz-Signature=private Bearer jwt-value', settings);
  for (const key of ['CLOUDFLARE_API_TOKEN', 'TIGRIS_ACCESS_KEY_ID', 'TIGRIS_SECRET_ACCESS_KEY']) assert.equal(value.includes(settings[key]), false);
  assert.equal(value.includes('X-Amz-Signature='), false);
  assert.throws(() => parseArgs(['--check', '--verify', 'x']));
  assert.throws(() => parseArgs(['--verify']));
});

test('batch works from a folder with spaces and retains child failure status without pause', { skip: process.platform !== 'win32' }, () => temporary(async (base, root) => {
  await cp(path.join(directory, 'backup.bat'), path.join(base, 'backup.bat'));
  await writeFile(path.join(base, 'backup.mjs'), "console.log('FIXTURE_NO_CLOUD ' + process.cwd()); console.error('fixture stderr'); process.exitCode = 7;\n");
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', '""' + path.join(base, 'backup.bat') + '" --check --no-pause"'],
    { cwd: root, encoding: 'utf8', timeout: 30000, windowsHide: true, windowsVerbatimArguments: true });
  assert.equal(result.status, 7, result.stdout + result.stderr);
  assert.ok(result.stdout.includes('FIXTURE_NO_CLOUD ' + base));
  assert.ok(result.stderr.includes('fixture stderr'));
}));

test('truncated SQL download cannot be renamed to a complete file', () => temporary(async base => {
  const target = path.join(base, 'database.sql');
  await assert.rejects(download(async () => new Response('CREATE TABLE x(id);', { headers: { 'Content-Length': '99999' } }),
    'https://download.fixture/sql', {}, target), /Content-Length/);
  assert.equal((await readdir(base)).includes('database.sql'), false);
  assert.equal((await readdir(base)).includes('database.sql.part'), true);
}));
