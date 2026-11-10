// Real HTTP + real SigV4 client against a local S3 fixture. No cloud account or credentials.
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import path from 'node:path';
import Database from 'better-sqlite3';
import { TigrisStorageDriver, type TigrisOptions } from '../apps/api/src/storage/tigris';
import { createCloudStorage } from '../apps/api/src/storage/factory';
import { R2StorageDriver } from '../apps/api/src/storage/storage';
import { createApp } from '../apps/api/src/index';
import { SqliteDatabaseClient } from '../apps/api/src/repositories/db';
import { runMigrations } from '../apps/api/src/repositories/migrationRunner';
import { createJwt, validateJarFile } from '../packages/shared-utils/src/index';

const accessKey = 'synthetic-tigris-access-key';
const secretKey = 'synthetic-tigris-secret-not-a-real-credential';
const jwtSecret = 'synthetic-tigris-api-signing-key-not-production';
const objects = new Map<string, { bytes: Buffer; type: string }>();
const calls: { method: string; key: string; query: URLSearchParams }[] = [];
const serverErrors: string[] = [];
let mode = 'normal';
let passed = 0;

const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const hmac = (key: string | Buffer, value: string) => createHmac('sha256', key).update(value).digest();

// Verify the wire request independently with node:crypto (the adapter uses aws4fetch).
function verifySignature(request: IncomingMessage, url: URL) {
  const auth = String(request.headers.authorization || '');
  const match = auth.match(/^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/);
  assert(match, 'Missing S3 SigV4 authorization');
  const [, keyId, date, region, headers, signature] = match;
  assert.equal(keyId, accessKey);
  assert.equal(region, 'auto');
  const query = [...url.searchParams].map(([key, value]) => [encode(key), encode(value)])
    .sort(([a, av], [b, bv]) => a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0)
    .map(pair => pair.join('=')).join('&');
  const canonicalHeaders = headers.split(';').map(name => `${name}:${String(request.headers[name] || '').trim().replace(/\s+/g, ' ')}\n`).join('');
  const canonical = [request.method, url.pathname.split('/').map(part => encode(decodeURIComponent(part))).join('/'), query,
    canonicalHeaders, headers, request.headers['x-amz-content-sha256']].join('\n');
  const scope = `${date}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', request.headers['x-amz-date'], scope, createHash('sha256').update(canonical).digest('hex')].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, date), region), 's3'), 'aws4_request');
  assert.equal(signature, hmac(signingKey, toSign).toString('hex'), 'Wire signature does not match canonical S3 request');
}

function listXml(entries: [string, { bytes: Buffer; type: string }][], truncated = false, next = '') {
  const escapedToken = next.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<?xml version="1.0"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><EncodingType>url</EncodingType><IsTruncated>${truncated}</IsTruncated>${entries.map(([key, object]) =>
    `<Contents><Key>${encodeURIComponent(key)}</Key><Size>${object.bytes.length}</Size><LastModified>2026-11-01T00:00:00Z</LastModified></Contents>`).join('')}<NextContinuationToken>${escapedToken}</NextContinuationToken></ListBucketResult>`;
}

// A data-only ZIP fixture; never executed. Stored manifest entry with valid CRC32.
function syntheticJar(): Buffer {
  const name = Buffer.from('META-INF/MANIFEST.MF');
  const data = Buffer.from('Manifest-Version: 1.0\r\nMIDlet-Name: Synthetic fixture\r\nMIDlet-1: Synthetic,,fixture.Main\r\n');
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

async function test(name: string, run: () => Promise<void> | void) {
  mode = 'normal';
  await run();
  passed++;
  console.log(`PASS Tigris: ${name}`);
}

async function main() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url!, `http://${request.headers.host}`);
      verifySignature(request, url);
      const key = decodeURIComponent(url.pathname.replace(/^\/fixture-bucket\/?/, ''));
      calls.push({ method: request.method!, key, query: url.searchParams });
      if (mode === 'hang') return; // Test timeout; teardown closes the socket.
      if (mode === 'redirect') { response.writeHead(307, { Location: '/should-not-follow' }); response.end(); return; }
      if (mode === 'forbidden' || mode === 'failure') {
        response.writeHead(mode === 'forbidden' ? 403 : 503); response.end(`<Error>${secretKey}</Error>`); return;
      }
      if (mode === 'missing-bucket') { response.writeHead(404); response.end('<Error><Code>NoSuchBucket</Code></Error>'); return; }
      if (url.searchParams.has('list-type')) {
        response.setHeader('Content-Type', 'application/xml');
        if (mode === 'malformed') { response.end('<ListBucketResult><Contents>'); return; }
        if (mode === 'doctype') { response.end('<!DOCTYPE x [<!ENTITY x "boom">]><ListBucketResult>&x;</ListBucketResult>'); return; }
        if (mode === 'bad-metadata') { response.end(listXml([['valid.jar', { bytes: Buffer.alloc(0), type: '' }]]).replace('<Size>0</Size>', '<Size>-1</Size>')); return; }
        if (mode === 'missing-token') { response.end(listXml([], true)); return; }
        if (mode === 'repeat-token') { response.end(listXml([], true, '00009&+')); return; }
        const entries = [...objects.entries()];
        const isNext = url.searchParams.has('continuation-token');
        response.end(mode === 'pagination' ? listXml(isNext ? entries.slice(1) : entries.slice(0, 1), !isNext, '00009&+') : listXml(entries));
        return;
      }
      if (request.method === 'PUT') {
        const parts = []; for await (const chunk of request) parts.push(chunk);
        objects.set(key, { bytes: Buffer.concat(parts), type: String(request.headers['content-type']) });
        response.writeHead(200); response.end(); return;
      }
      if (request.method === 'DELETE') { objects.delete(key); response.writeHead(204); response.end(); return; }
      const object = objects.get(key);
      if (!object) { response.writeHead(404); response.end('<Error><Code>NoSuchKey</Code></Error>'); return; }
      response.setHeader('Content-Type', object.type); response.end(object.bytes);
    } catch (error) {
      serverErrors.push(String(error)); response.writeHead(500); response.end('Fixture rejected request');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const endpoint = `http://127.0.0.1:${address.port}`;
  const options: TigrisOptions = { endpoint, bucket: 'fixture-bucket', accessKeyId: accessKey, secretAccessKey: secretKey, allowLocalHttp: true };
  const driver = new TigrisStorageDriver(options);
  try {
    await test('configuration fails closed and R2 remains compatible', () => {
      for (const endpoint of ['http://example.invalid', 'https://user:pass@example.invalid', 'https://example.invalid/path', 'https://example.invalid?key=x', 'https://example.invalid/#hash']) {
        assert.throws(() => new TigrisStorageDriver({ ...options, endpoint }));
      }
      assert.throws(() => new TigrisStorageDriver({ ...options, allowLocalHttp: false }));
      assert.throws(() => new TigrisStorageDriver({ ...options, accessKeyId: '' }));
      assert.throws(() => new TigrisStorageDriver({ ...options, bucket: '../bad' }));
      assert.throws(() => createCloudStorage({ STORAGE_PROVIDER: 'tigris', DB: null, JWT_SECRET: jwtSecret }));
      assert(createCloudStorage({ BUCKET: {}, DB: null, JWT_SECRET: jwtSecret }) instanceof R2StorageDriver);
      assert.throws(() => createCloudStorage({ STORAGE_PROVIDER: 'r2', DB: null, JWT_SECRET: jwtSecret }));
    });
    await test('binary PUT/GET, content type, sliced buffers and special characters', async () => {
      const key = "users/owner/game 00123 & + # % ' (Việt).jar";
      await driver.put(key, new Uint8Array([0, 1, 128, 255, 2]).subarray(1, 4), 'application/java-archive');
      const result = await driver.get(key);
      assert(result); assert.deepEqual(new Uint8Array(result.data), new Uint8Array([1, 128, 255]));
      assert.equal(result.contentType, 'application/java-archive');
      assert.equal(driver.getUrl(key), `/api/v1/assets/raw/${encodeURIComponent(key)}`);
      assert(!driver.getUrl(key).includes(endpoint));
    });
    await test('missing object returns null; a missing bucket is an error', async () => {
      assert.equal(await driver.get('missing.jar'), null);
      mode = 'missing-bucket'; await assert.rejects(driver.get('missing.jar'), /HTTP 404/);
    });
    await test('invalid keys never make an HTTP request', async () => {
      const before = calls.length;
      for (const key of ['', '../x', '/absolute', 'a/../x', 'a\\x', 'a//x', 'a/./b', 'nul\0byte']) {
        await assert.rejects(driver.get(key)); await assert.rejects(driver.put(key, new Uint8Array(), 'text/plain'));
        await assert.rejects(driver.delete(key)); assert.throws(() => driver.getUrl(key));
      }
      assert.equal(calls.length, before);
    });
    await test('LIST decodes names and retains leading zeroes across pagination', async () => {
      await driver.put('00123', new Uint8Array(), 'application/octet-stream');
      mode = 'pagination';
      const listed = await driver.list();
      assert.equal(listed.length, 2); assert(listed.some(item => item.key === '00123' && item.size === 0));
      assert(listed.some(item => item.key.includes('Việt') && item.key.includes('&')));
      assert.equal(calls.at(-1)!.query.get('continuation-token'), '00009&+');
    });
    for (const bad of ['malformed', 'doctype', 'bad-metadata', 'missing-token', 'repeat-token']) {
      await test(`LIST rejects ${bad} instead of treating storage as empty`, async () => {
        mode = bad; await assert.rejects(driver.list());
      });
    }
    for (const bad of ['forbidden', 'failure']) {
      await test(`${bad} is an error without retries or leaking upstream secrets`, async () => {
        mode = bad;
        for (const operation of [() => driver.get('x.jar'), () => driver.put('x.jar', new Uint8Array([1]), 'x/test'), () => driver.delete('x.jar'), () => driver.list()]) {
          const before = calls.length;
          await assert.rejects(operation(), error => error instanceof Error && !error.message.includes(secretKey) && /HTTP/.test(error.message));
          assert.equal(calls.length, before + 1);
        }
      });
    }
    await test('signed requests do not follow redirects', async () => {
      mode = 'redirect'; const before = calls.length;
      await assert.rejects(driver.get('redirect.jar'), /HTTP 307/); assert.equal(calls.length, before + 1);
    });
    await test('unresponsive storage has a bounded timeout', async () => {
      mode = 'hang';
      const quick = new TigrisStorageDriver({ ...options, requestTimeoutMs: 100 });
      await assert.rejects(quick.get('timeout.jar'), /hết thời gian chờ/);
    });
    await test('DELETE and empty LIST', async () => {
      for (const key of [...objects.keys()]) await driver.delete(key);
      await driver.delete('already-missing.jar');
      assert.deepEqual(await driver.list(), []);
    });

    const sqlite = new Database(':memory:');
    const db = new SqliteDatabaseClient(sqlite);
    runMigrations(db, path.resolve(__dirname, '../database/migrations'));
    for (const [id, role] of [['admin', 'ADMIN'], ['owner', 'USER'], ['other', 'USER']]) {
      sqlite.prepare('INSERT INTO users (id, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?)').run(id, id, `${id}@fixture.invalid`, 'unused-fixture-hash', role);
    }
    const env = { DB: null, JWT_SECRET: jwtSecret, ENVIRONMENT: 'test', STORAGE_PROVIDER: 'tigris' as const, TIGRIS_ENDPOINT: endpoint,
      TIGRIS_BUCKET: 'fixture-bucket', TIGRIS_ACCESS_KEY_ID: accessKey, TIGRIS_SECRET_ACCESS_KEY: secretKey };
    const app = createApp(db); // Exercise production provider selection, not an injected storage double.
    const tokens = Object.fromEntries(await Promise.all(['admin', 'owner', 'other'].map(async id => [id, await createJwt({ userId: id }, jwtSecret)])));
    const api = (url: string, options: RequestInit = {}, actor?: string) => app.fetch(new Request(`http://fixture.invalid${url}`, {
      ...options, headers: { ...(actor ? { Authorization: `Bearer ${tokens[actor]}` } : {}), ...options.headers },
    }), env);
    try {
      const jar = syntheticJar();
      let asset: any;
      await test('real upload API validates and writes JAR to Tigris, without publishing it', async () => {
        assert.equal((await validateJarFile(jar)).valid, true);
        const form = new FormData(); form.append('file', new File([jar], 'synthetic.jar', { type: 'application/java-archive' }));
        const response = await api('/api/v1/upload', { method: 'POST', body: form }, 'owner');
        assert.equal(response.status, 201, await response.clone().text()); asset = (await response.json()).data;
        assert(asset.storage_key.startsWith('users/owner/')); assert.equal(asset.status, 'ACTIVE');
        assert.deepEqual(objects.get(asset.storage_key)?.bytes, jar);
        const imported = await api('/api/v1/me/imports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ custom_name: 'Private fixture', jar_asset_id: asset.id }) }, 'owner');
        assert.equal(imported.status, 201, await imported.clone().text());
        const libraryId = (await imported.json()).data.id;
        const libraryItem = sqlite.prepare('SELECT user_id, source_type FROM user_library WHERE id = ?').get(libraryId) as any;
        assert.equal(libraryItem.user_id, 'owner'); assert.equal(libraryItem.source_type, 'IMPORT');
        assert.equal((sqlite.prepare('SELECT count(*) AS n FROM games').get() as any).n, 0);
      });
      await test('owner GET/HEAD/Range receive original bytes through the existing asset API', async () => {
        const url = driver.getUrl(asset.storage_key);
        const whole = await api(url, {}, 'owner'); assert.equal(whole.status, 200);
        assert.deepEqual(Buffer.from(await whole.arrayBuffer()), jar); assert.match(whole.headers.get('Cache-Control')!, /no-store/);
        const range = await api(url, { headers: { Range: 'bytes=0-3' } }, 'owner'); assert.equal(range.status, 206);
        assert.deepEqual(Buffer.from(await range.arrayBuffer()), jar.subarray(0, 4));
        const head = await api(url, { method: 'HEAD' }, 'owner'); assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0);
      });
      await test('guest/other/blocked owners are denied before any Tigris request', async () => {
        const url = driver.getUrl(asset.storage_key);
        for (const actor of [undefined, 'other']) for (const method of ['GET', 'HEAD']) {
          const before = calls.length; const response = await api(url, { method, headers: { Range: 'bytes=0-3' } }, actor);
          assert.equal(response.status, actor ? 403 : 401); assert.equal(calls.length, before);
        }
        sqlite.prepare("UPDATE users SET status='BLOCKED' WHERE id='owner'").run();
        const before = calls.length; assert.equal((await api(url, {}, 'owner')).status, 403); assert.equal(calls.length, before);
        sqlite.prepare("UPDATE users SET status='ACTIVE' WHERE id='owner'").run();
      });
      await test('admin storage analysis and deletion use Tigris and remove private library references', async () => {
        const analysis = await api('/api/v1/admin/storage/analysis', {}, 'admin'); assert.equal(analysis.status, 200);
        assert.equal((await analysis.json()).data.totalDiskBytes, jar.length);
        const deleted = await api(`/api/v1/admin/assets/${asset.id}`, { method: 'DELETE' }, 'admin');
        assert.equal(deleted.status, 200); assert(!objects.has(asset.storage_key));
        assert.equal((sqlite.prepare('SELECT count(*) AS n FROM user_library').get() as any).n, 0);
        assert.equal((await api(driver.getUrl(asset.storage_key), {}, 'owner')).status, 404);
      });
    } finally { sqlite.close(); }
    assert.deepEqual(serverErrors, []);
    console.log(`Tigris: ${passed} cases passed; ${calls.length} signed HTTP requests verified. Local S3 fixture, not a live Tigris account.`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
