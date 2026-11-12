// Standalone Node.js 22 + Windows PowerShell. No project imports or npm install.
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, readFileSync, writeSync } from 'node:fs';
import { mkdir, open, readFile, writeFile, rename, unlink, stat, realpath, statfs, lstat } from 'node:fs/promises';
import { Transform, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ownDirectory = path.dirname(fileURLToPath(import.meta.url));
const CF_ORIGIN = 'https://api.cloudflare.com';
const REQUIRED = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'D1_DATABASE_ID',
  'TIGRIS_BUCKET', 'TIGRIS_ACCESS_KEY_ID', 'TIGRIS_SECRET_ACCESS_KEY'];
const OPTIONAL = ['D1_DATABASE_NAME', 'TIGRIS_ENDPOINT', 'TIGRIS_REGION'];
const SECRET = ['CLOUDFLARE_API_TOKEN', 'TIGRIS_ACCESS_KEY_ID', 'TIGRIS_SECRET_ACCESS_KEY'];
const EMPTY_HASH = createHash('sha256').update('').digest('hex');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const id = () => new Date().toISOString().replace(/[-:]/g, '').replace('.', '-') + '-' + randomUUID().slice(0, 8);
const json = async (filename, value) => {
  const temporary = filename + '.tmp';
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, filename);
};

export function redact(message, settings = {}) {
  let output = String(message);
  for (const name of SECRET) if (settings[name]) {
    output = output.replaceAll(settings[name], '[REDACTED]').replaceAll(encodeURIComponent(settings[name]), '[REDACTED]');
  }
  return output.replace(/https?:\/\/[^\s"'<>]*[?&]X-Amz-[^\s"'<>]*/gi, '[SIGNED_URL_REDACTED]')
    .replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]');
}

export function validateSettings(input) {
  const settings = Object.fromEntries([...REQUIRED, ...OPTIONAL].filter(key => input[key]).map(key => [key, input[key]]));
  if (REQUIRED.some(key => !settings[key]?.trim())) throw new Error('Thieu cau hinh: ' + REQUIRED.filter(key => !settings[key]?.trim()).join(', '));
  if (!/^[a-f0-9]{32}$/i.test(settings.CLOUDFLARE_ACCOUNT_ID)) throw new Error('CLOUDFLARE_ACCOUNT_ID khong hop le.');
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(settings.D1_DATABASE_ID)) throw new Error('D1_DATABASE_ID khong hop le.');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(settings.TIGRIS_BUCKET)) throw new Error('TIGRIS_BUCKET khong hop le.');
  if (SECRET.some(key => /[\s\x00-\x1f\x7f"']/.test(settings[key]))) throw new Error('Token/key chua ky tu khong hop le.');
  settings.TIGRIS_ENDPOINT ||= 'https://t3.storage.dev';
  settings.TIGRIS_REGION ||= 'auto';
  const endpoint = new URL(settings.TIGRIS_ENDPOINT);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
    throw new Error('TIGRIS_ENDPOINT phai la HTTPS origin.');
  }
  if (!/^[a-zA-Z0-9-]+$/.test(settings.TIGRIS_REGION)) throw new Error('TIGRIS_REGION khong hop le.');
  settings.TIGRIS_ENDPOINT = endpoint.origin;
  return settings;
}

export async function loadSettings(base) {
  const local = path.join(base, '.env.backup.local');
  let text, imported = false;
  try { text = await readFile(local, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Khong doc duoc .env.backup.local.');
    try { text = await readFile(path.resolve(base, '..', '.env.deploy.local'), 'utf8'); imported = true; }
    catch { throw new Error('Dien .env.backup.local theo file mau; folder backup co the chay ngoai project.'); }
  }
  const settings = validateSettings(parseEnv(text.replace(/^\uFEFF/, '')));
  if (imported) {
    const content = '# Cau hinh rieng cua backup; khong sua file goc.\n' +
      Object.entries(settings).map(([key, value]) => key + '=' + JSON.stringify(value)).join('\n') + '\n';
    await writeFile(local, content, { flag: 'wx', mode: 0o600 });
  }
  return settings;
}

export function validateKey(key) {
  if (typeof key !== 'string' || !key || /[\x00-\x1f\x7f\\]/.test(key) ||
      key.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Storage key khong hop le; dung backup de tranh luu sai file.');
}

export function signS3(settings, key, query = {}, extraHeaders = {}, now = new Date()) {
  if (key !== null) validateKey(key);
  const uri = '/' + encode(settings.TIGRIS_BUCKET) + (key === null ? '' : '/' + key.split('/').map(encode).join('/'));
  const canonicalQuery = Object.entries(query).map(([k, v]) => [encode(k), encode(String(v))])
    .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)
    .map(([k, v]) => k + '=' + v).join('&');
  const timestamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = timestamp.slice(0, 8);
  const host = new URL(settings.TIGRIS_ENDPOINT).host;
  const headers = { host, 'x-amz-content-sha256': EMPTY_HASH, 'x-amz-date': timestamp, ...extraHeaders };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map(name => name + ':' + String(headers[name]).trim() + '\n').join('');
  const scope = day + '/' + settings.TIGRIS_REGION + '/s3/aws4_request';
  const canonical = ['GET', uri, canonicalQuery, canonicalHeaders, names.join(';'), EMPTY_HASH].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', timestamp, scope, sha256(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac('AWS4' + settings.TIGRIS_SECRET_ACCESS_KEY, day), settings.TIGRIS_REGION), 's3'), 'aws4_request');
  headers.Authorization = 'AWS4-HMAC-SHA256 Credential=' + settings.TIGRIS_ACCESS_KEY_ID + '/' + scope +
    ', SignedHeaders=' + names.join(';') + ', Signature=' + createHmac('sha256', signingKey).update(toSign).digest('hex');
  delete headers.host; // fetch supplies the exact URL host.
  return { url: settings.TIGRIS_ENDPOINT + uri + (canonicalQuery ? '?' + canonicalQuery : ''), headers };
}

export function parseList(xml) {
  if (Buffer.byteLength(xml) > 8 * 1024 * 1024) throw new Error('Tigris LIST qua lon.');
  let result;
  try {
    const source = readFileSync(new URL('./parse-s3-list.ps1', import.meta.url), 'utf8');
    result = JSON.parse(execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(source, 'utf16le').toString('base64')], { input: xml, encoding: 'utf8', maxBuffer: 12 * 1024 * 1024, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }).replace(/^\uFEFF/, ''));
  } catch { throw new Error('Tigris LIST XML khong hop le hoac khong chay duoc Windows PowerShell.'); }
  if (result.encoding !== 'url' || !['true', 'false'].includes(result.truncated) || !Array.isArray(result.items)) throw new Error('Tigris LIST metadata khong hop le.');
  const objects = result.items.map(item => {
    let key;
    try { key = decodeURIComponent(item.key); } catch { throw new Error('Tigris LIST key encoding khong hop le.'); }
    validateKey(key);
    if (!/^\d+$/.test(item.size) || !Number.isSafeInteger(Number(item.size)) || !Number.isFinite(Date.parse(item.modified)) ||
        typeof item.etag !== 'string' || !item.etag || /[\x00-\x1f\x7f]/.test(item.etag)) throw new Error('Tigris LIST object khong hop le.');
    return { key, size: Number(item.size), etag: item.etag, modified: item.modified };
  });
  if (result.truncated === 'true' && (typeof result.next !== 'string' || !result.next)) throw new Error('Tigris LIST thieu continuation token.');
  return { objects, next: result.truncated === 'true' ? result.next : null };
}

export async function responseText(response, limit) {
  if (!response.body) return '';
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > limit) throw new Error('Phan hoi metadata qua lon.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function request(fetcher, url, options, operation, timeout = 60000) {
  let response;
  try { response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(timeout) }); }
  catch { throw new Error(operation + ': khong ket noi duoc, redirect hoac het thoi gian cho.'); }
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(operation + ': HTTP ' + response.status + '. Kiem tra token/key, quyen va tai nguyen.');
  }
  return response;
}

export async function hashFile(filename) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(filename)) { size += chunk.length; hash.update(chunk); }
  return { size, sha256: hash.digest('hex') };
}

export async function download(fetcher, url, headers, filename, expected = {}, log = () => {}) {
  const response = await request(fetcher, url, { headers: { 'Accept-Encoding': 'identity', ...headers } }, 'Tai file', 300000);
  const hash = createHash('sha256');
  let size = 0, lastProgress = Date.now();
  const meter = new Transform({ transform(chunk, encoding, callback) {
    size += chunk.length;
    hash.update(chunk);
    if (expected.size !== undefined && size > expected.size) return callback(new Error('File lon hon metadata.'));
    if (Date.now() - lastProgress > 10000) { log('Da nhan ' + size + ' bytes...'); lastProgress = Date.now(); }
    callback(null, chunk);
  } });
  if (!response.body) throw new Error('File tra ve khong co body.');
  const temporary = filename + '.part';
  try {
    await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(temporary, { flags: 'wx', mode: 0o600, flush: true }));
  } catch { throw new Error('Tai file khong hoan tat; giu .part de kiem tra, chua coi la backup thanh cong.'); }
  const digest = hash.digest('hex');
  const declared = response.headers.get('content-length');
  if (!response.headers.has('content-encoding') && declared !== null &&
      (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || size !== Number(declared))) {
    throw new Error('File khong khop Content-Length; giu .part, chua coi la backup thanh cong.');
  }
  if (expected.size !== undefined && size !== expected.size) throw new Error('Kich thuoc file khong khop metadata.');
  if (expected.sha256 && digest !== expected.sha256.toLowerCase()) throw new Error('SHA-256 file khong khop database.');
  if (expected.etag && response.headers.get('etag') !== expected.etag) throw new Error('ETag da thay doi khi tai file.');
  if (await stat(filename).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) throw new Error('Khong ghi de file backup da ton tai.');
  await rename(temporary, filename);
  return { size, sha256: digest };
}

async function cf(settings, suffix, method, payload, fetcher) {
  const endpoint = CF_ORIGIN + '/client/v4/accounts/' + settings.CLOUDFLARE_ACCOUNT_ID +
    '/d1/database/' + settings.D1_DATABASE_ID + suffix;
  const response = await request(fetcher, endpoint, {
    method, headers: { Authorization: 'Bearer ' + settings.CLOUDFLARE_API_TOKEN, 'Content-Type': 'application/json' },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  }, 'Cloudflare D1 ' + (suffix || 'metadata'));
  let body;
  try { body = JSON.parse(await responseText(response, 16 * 1024 * 1024)); }
  catch { throw new Error('Cloudflare tra JSON khong hop le.'); }
  if (body.success !== true || body.result == null) throw new Error('Cloudflare tu choi yeu cau D1; kiem tra quyen token.');
  return body.result;
}

export async function listBucket(settings, fetcher = fetch) {
  const objects = [], tokens = new Set(), keys = new Set();
  let token;
  do {
    const query = { 'list-type': '2', 'max-keys': '1000', 'encoding-type': 'url' };
    if (token) query['continuation-token'] = token;
    const signed = signS3(settings, null, query);
    const response = await request(fetcher, signed.url, { headers: signed.headers }, 'Tigris LIST');
    const page = parseList(await responseText(response, 8 * 1024 * 1024));
    for (const object of page.objects) {
      if (keys.has(object.key)) throw new Error('Tigris LIST lap storage key; chua co inventory dang tin cay.');
      keys.add(object.key); objects.push(object);
    }
    token = page.next;
    if (token && tokens.has(token)) throw new Error('Tigris LIST lap continuation token.');
    if (token) tokens.add(token);
    if (tokens.size > 10000) throw new Error('Tigris LIST vuot gioi han phan trang.');
  } while (token);
  return objects.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

export async function readAssets(settings, fetcher = fetch, pageSize = 500) {
  const assets = [];
  let cursor = '';
  for (let page = 0; page < 10000; page++) {
    const result = await cf(settings, '/query', 'POST', {
      sql: 'SELECT id, asset_type, storage_key, original_filename, file_size, sha256, status FROM game_assets WHERE id > ? ORDER BY id LIMIT ?',
      params: [cursor, pageSize],
    }, fetcher);
    if (!Array.isArray(result) || result.length !== 1 || result[0]?.success !== true || !Array.isArray(result[0].results)) throw new Error('D1 game_assets response khong hop le.');
    const rows = result[0].results;
    for (const row of rows) {
      if (typeof row.id !== 'string' || row.id <= cursor || typeof row.original_filename !== 'string') throw new Error('D1 game_assets identity khong hop le.');
      validateKey(row.storage_key);
      if (!Number.isSafeInteger(row.file_size) || row.file_size < 0 ||
          (row.status === 'ACTIVE' && !/^[a-f0-9]{64}$/i.test(row.sha256))) throw new Error('D1 game_assets size/hash khong hop le.');
      assets.push({ id: row.id, asset_type: row.asset_type, storage_key: row.storage_key,
        original_filename: row.original_filename, file_size: row.file_size, sha256: row.sha256, status: row.status });
      cursor = row.id;
    }
    if (rows.length < pageSize) return assets;
  }
  throw new Error('D1 game_assets vuot gioi han phan trang.');
}

export async function exportD1(settings, fetcher = fetch, delay = sleep, log = () => {}) {
  let bookmark;
  for (let poll = 0; poll < 180; poll++) {
    const result = await cf(settings, '/export', 'POST', {
      output_format: 'polling',
      dump_options: { no_data: false, no_schema: false, compatibility: 'd1' },
      ...(bookmark ? { current_bookmark: bookmark } : {}),
    }, fetcher);
    if (result.status === 'error' || result.success === false) throw new Error('D1 export that bai; khong thay doi schema de vuot qua loi.');
    if (result.status === 'complete') {
      if (bookmark && result.at_bookmark && result.at_bookmark !== bookmark) throw new Error('D1 export bookmark thay doi luc hoan tat.');
      let url;
      try { url = new URL(result.result?.signed_url); } catch { throw new Error('D1 export thieu URL tai SQL.'); }
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('D1 export URL khong an toan.');
      return { url: url.href, bookmark: result.at_bookmark || bookmark || null };
    }
    if (typeof result.at_bookmark !== 'string' || !result.at_bookmark ||
        (bookmark && result.at_bookmark !== bookmark)) throw new Error('D1 export bookmark khong hop le.');
    bookmark = result.at_bookmark;
    log('D1 export dang chay; cho 2 giay...');
    await delay(2000);
  }
  throw new Error('D1 export chua xong sau gioi han polling; chua co SQL backup.');
}

async function plainDirectory(base, name) {
  const target = path.join(base, name);
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Thu muc backup khong duoc la symlink/file.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(target);
  }
  return target;
}

export function backupPath(key, asset) {
  validateKey(key);
  const extension = key.match(/\.([a-zA-Z0-9]{1,8})$/)?.[1].toLowerCase();
  const isJar = asset?.asset_type === 'JAR' || extension === 'jar';
  return (isJar ? 'game_jar/' : 'storage_assets/') + sha256(key) + (isJar ? '.jar' : extension ? '.' + extension : '.bin');
}

export async function verifySnapshot(directory, { allowInProgress = false, log = () => {} } = {}) {
  const base = await realpath(directory);
  const manifest = JSON.parse(await readFile(path.join(base, 'manifest.json'), 'utf8'));
  if (manifest.format !== 1 || (!allowInProgress && manifest.status !== 'complete') ||
      !manifest.database || !manifest.asset_index || !Array.isArray(manifest.inventory) ||
      !Array.isArray(manifest.files) || manifest.files.length !== manifest.inventory.length) throw new Error('Snapshot chua hoan tat hoac manifest khong hop le.');
  const records = [manifest.database, manifest.asset_index, ...manifest.files];
  const seen = new Set(), inventory = new Map(manifest.inventory.map(item => [item.key, item]));
  for (const record of records) {
    if (typeof record.file !== 'string' || /[\\:]/.test(record.file) ||
        record.file.split('/').some(part => !part || part === '.' || part === '..') ||
        seen.has(record.file) || !/^[a-f0-9]{64}$/.test(record.sha256) ||
        !Number.isSafeInteger(record.size) || record.size < 0) throw new Error('Manifest file khong hop le.');
    seen.add(record.file);
    const filename = await realpath(path.resolve(base, record.file));
    const relative = path.relative(base, filename);
    if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new Error('Manifest tro ra ngoai snapshot.');
    const actual = await hashFile(filename);
    if (actual.size !== record.size || actual.sha256 !== record.sha256) throw new Error('File backup bi thieu/hong: ' + record.file);
    if (record.key !== undefined) {
      const original = inventory.get(record.key);
      if (!original || original.size !== actual.size) throw new Error('Inventory khong khop file backup.');
      inventory.delete(record.key);
    }
    log('OK ' + record.file);
  }
  if (inventory.size) throw new Error('Inventory con file chua duoc backup.');
  return manifest;
}

export async function runBackup(baseDirectory, settings, { fetcher = fetch, check = false, log = () => {}, delay = sleep } = {}) {
  const base = await realpath(baseDirectory);
  const lockPath = path.join(base, '.backup.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch { throw new Error('Dang co backup/check khac, hoac con .backup.lock tu lan dung dot ngot. Xem HUONG_DAN.txt.'); }
  let run, manifest;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
    log('[1/7] Kiem tra dung D1 va doc danh sach bucket (khong export o che do --check).');
    const database = await cf(settings, '', 'GET', null, fetcher);
    if (settings.D1_DATABASE_NAME && database.name !== settings.D1_DATABASE_NAME) throw new Error('D1_DATABASE_NAME khong khop database tren cloud.');
    const assets = await readAssets(settings, fetcher);
    const inventory = await listBucket(settings, fetcher);
    const assetMap = new Map(assets.map(asset => [asset.storage_key, asset]));
    const objectMap = new Map(inventory.map(object => [object.key, object]));
    const issues = [];
    for (const asset of assets.filter(asset => asset.status === 'ACTIVE')) {
      if (!objectMap.has(asset.storage_key)) issues.push('Thieu object ACTIVE: ' + asset.storage_key);
      else if (objectMap.get(asset.storage_key).size !== asset.file_size) issues.push('Object size khac D1: ' + asset.storage_key);
    }
    const totalBytes = inventory.reduce((sum, item) => sum + item.size, 0);
    if (!Number.isSafeInteger(totalBytes)) throw new Error('Tong dung luong khong hop le.');
    log('Inventory: ' + inventory.length + ' files, ' + totalBytes + ' bytes; D1 assets: ' + assets.length + '.');
    if (check) {
      if (issues.length) throw new Error(issues.join('\n'));
      log('CHECK OK. Chua export D1, chua tai game; quyen export chua duoc xac minh.');
      return { checked: true, objects: inventory.length, bytes: totalBytes };
    }
    const snapshots = await plainDirectory(base, 'snapshots');
    run = path.join(snapshots, id());
    await mkdir(run);
    await plainDirectory(run, 'game_jar'); await plainDirectory(run, 'storage_assets');
    try {
      const space = await statfs(run, { bigint: true });
      if (space.bavail * space.bsize < BigInt(totalBytes) + 100n * 1024n * 1024n) throw new Error('Khong du dung luong o dia cho snapshot.');
    } catch (error) {
      if (error.message === 'Khong du dung luong o dia cho snapshot.') throw error;
      log('Khong doc duoc dung luong trong; loi ghi file se lam snapshot INCOMPLETE.');
    }
    manifest = { format: 1, status: 'in_progress', started_at: new Date().toISOString(),
      source: { database_id: settings.D1_DATABASE_ID, database_name: database.name,
        bucket: settings.TIGRIS_BUCKET, endpoint: settings.TIGRIS_ENDPOINT },
      consistency: 'D1 SQL snapshot + asset-index/inventory compared before and after; not an atomic snapshot across providers.',
      inventory, files: [], issues };
    await json(path.join(run, 'manifest.json'), manifest);
    await json(path.join(run, 'assets-index.json'), assets);
    manifest.asset_index = { file: 'assets-index.json', ...await hashFile(path.join(run, 'assets-index.json')) };
    log('[2/7] Export D1 schema + data. Cloudflare co the tam chan cac truy van trong luc export.');
    const exported = await exportD1(settings, fetcher, delay, log);
    const sqlPath = path.join(run, 'database.sql');
    manifest.database = { file: 'database.sql', ...await download(fetcher, exported.url, {}, sqlPath, {}, log) };
    // Never attach the Cloudflare bearer token to the signed SQL download URL.
    const sql = await open(sqlPath, 'r');
    try {
      const prefix = Buffer.alloc(65536);
      const result = await sql.read(prefix, 0, prefix.length, 0);
      if (!/\bCREATE\s+TABLE\b/i.test(prefix.toString('utf8', 0, result.bytesRead))) throw new Error('SQL export khong co schema mong doi.');
    } finally { await sql.close(); }
    manifest.database.bookmark = exported.bookmark;
    await json(path.join(run, 'manifest.json'), manifest);
    log('[3/7] Tai toan bo bucket: JAR, JAD, cover, screenshot va object khac.');
    for (const [index, object] of inventory.entries()) {
      const asset = assetMap.get(object.key);
      const file = backupPath(object.key, asset);
      log('[' + (index + 1) + '/' + inventory.length + '] ' + object.key);
      try {
        const signed = signS3(settings, object.key, {}, { 'if-match': object.etag });
        const actual = await download(fetcher, signed.url, signed.headers, path.join(run, file), {
          size: object.size, etag: object.etag, ...(asset?.status === 'ACTIVE' ? { sha256: asset.sha256 } : {}),
        }, log);
        manifest.files.push({ key: object.key, file, ...actual, etag: object.etag,
          asset_id: asset?.id || null, original_filename: asset?.original_filename || null });
      } catch (error) {
        issues.push(object.key + ': ' + redact(error.message, settings));
        log('ERROR: ' + issues.at(-1));
      }
      await json(path.join(run, 'manifest.json'), manifest);
    }
    log('[4/7] Kiem tra bucket khong thay doi trong luc tai.');
    if (JSON.stringify(await listBucket(settings, fetcher)) !== JSON.stringify(inventory)) issues.push('Bucket thay doi trong luc backup; can chay lai khi khong upload/xoa/sua game.');
    log('[5/7] Kiem tra asset index D1 khong thay doi trong luc backup.');
    if (JSON.stringify(await readAssets(settings, fetcher)) !== JSON.stringify(assets)) issues.push('D1 asset index thay doi trong luc backup; can chay lai.');
    if (issues.length) throw new Error('Snapshot INCOMPLETE: ' + issues.join('\n'));
    log('[6/7] Doc lai toan bo file tren o dia, kiem tra SHA-256.');
    await verifySnapshot(run, { allowInProgress: true, log });
    manifest.status = 'complete';
    manifest.finished_at = new Date().toISOString();
    await json(path.join(run, 'manifest.json'), manifest);
    log('[7/7] BACKUP COMPLETE: ' + run);
    return { directory: run, manifest };
  } catch (error) {
    if (run && manifest) {
      manifest.status = 'incomplete'; manifest.finished_at = new Date().toISOString();
      manifest.error = redact(error.message, settings);
      await json(path.join(run, 'manifest.json'), manifest);
      log('INCOMPLETE (giu cac file da tai): ' + run);
    }
    throw error;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

export function parseArgs(args) {
  const result = { mode: 'backup' };
  let selected = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--no-pause') continue;
    if (args[i] === '--help') { result.help = true; continue; }
    if (!['--check', '--verify'].includes(args[i]) || selected) throw new Error('Dung: backup.bat [--check | --verify snapshots\\TEN_BAN] [--no-pause]');
    selected = true; result.mode = args[i].slice(2);
    if (result.mode === 'verify') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('--verify can duong dan snapshot trong folder backup.');
      result.directory = args[++i];
    }
  }
  return result;
}

export async function main(args = process.argv.slice(2), baseDirectory = ownDirectory) {
  let settings = {}, logger;
  const base = await realpath(baseDirectory);
  const logs = await plainDirectory(base, 'logs');
  logger = await open(path.join(logs, id() + '.log'), 'wx', 0o600);
  const log = message => {
    const line = '[' + new Date().toISOString() + '] ' + redact(message, settings).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '') + '\n';
    process.stdout.write(line); writeSync(logger.fd, line);
  };
  try {
    if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Can Node.js 22 tro len.');
    const options = parseArgs(args);
    if (options.help) { log('backup.bat | --check | --verify snapshots\\TEN_BAN | --no-pause. Xem HUONG_DAN.txt.'); return; }
    if (options.mode === 'verify') {
      const directory = await realpath(path.resolve(base, options.directory));
      const relative = path.relative(base, directory);
      if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new Error('Chi verify snapshot nam trong folder backup.');
      await verifySnapshot(directory, { log }); log('VERIFY OK. Khong ket noi cloud.');
    } else {
      settings = await loadSettings(base);
      log('Backup doc cloud truc tiep; khong goi website, khong deploy, khong ghi/xoa du lieu cloud.');
      await runBackup(base, settings, { check: options.mode === 'check', log });
    }
  } catch (error) {
    log('ERROR: ' + error.message);
    process.exitCode = 1;
  } finally { await logger.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('ERROR: Khong khoi tao duoc folder/log backup.'); process.exitCode = 1; });
}
