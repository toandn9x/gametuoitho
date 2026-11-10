// Deployment helper shared by deploy.bat and the CLI. Secrets never enter command-line arguments.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = path.join(root, 'apps/api');
const apiRequire = createRequire(path.join(apiDir, 'package.json'));

export function readSettings(filename) {
  let input;
  try { input = parseEnv(readFileSync(filename, 'utf8')); }
  catch { throw new Error('Chưa đọc được .env.deploy.local; mở file mẫu và điền trên máy, không gửi khóa vào chat.'); }
  const required = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'D1_DATABASE_ID', 'TIGRIS_BUCKET', 'TIGRIS_ACCESS_KEY_ID', 'TIGRIS_SECRET_ACCESS_KEY'];
  const missing = required.filter(key => !input[key]?.trim());
  if (missing.length) throw new Error(`Cần điền các mục: ${missing.join(', ')}`);
  if (!/^[a-f0-9]{32}$/i.test(input.CLOUDFLARE_ACCOUNT_ID)) throw new Error('CLOUDFLARE_ACCOUNT_ID phải là 32 ký tự hex.');
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input.D1_DATABASE_ID)) throw new Error('D1_DATABASE_ID phải là UUID của database.');
  const worker = input.WORKER_NAME || 'gametuoitho';
  const database = input.D1_DATABASE_NAME || 'gametuoitho-d1';
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(worker)) throw new Error('WORKER_NAME không hợp lệ.');
  if (!/^[a-zA-Z0-9_-]{1,63}$/.test(database)) throw new Error('D1_DATABASE_NAME không hợp lệ.');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(input.TIGRIS_BUCKET)) throw new Error('TIGRIS_BUCKET không hợp lệ.');
  for (const key of ['CLOUDFLARE_API_TOKEN', 'TIGRIS_ACCESS_KEY_ID', 'TIGRIS_SECRET_ACCESS_KEY']) {
    if (/[\s\x00-\x1f\x7f]/.test(input[key])) throw new Error(`${key} chứa khoảng trắng hoặc ký tự điều khiển.`);
  }
  if (input.JWT_SECRET && input.JWT_SECRET.length < 32) throw new Error('JWT_SECRET phải có ít nhất 32 ký tự, hoặc để trống.');
  return { ...input, WORKER_NAME: worker, D1_DATABASE_NAME: database, GOOGLE_CLIENT_ID: input.GOOGLE_CLIENT_ID || '' };
}

export function redact(message, settings) {
  let text = String(message);
  for (const key of ['CLOUDFLARE_API_TOKEN', 'TIGRIS_ACCESS_KEY_ID', 'TIGRIS_SECRET_ACCESS_KEY', 'JWT_SECRET']) {
    if (settings[key]) text = text.replaceAll(settings[key], '[REDACTED]');
  }
  return text;
}

export function renderConfig(source, settings, projectRoot = root) {
  let section = '';
  let changedDb = false;
  let changedBucket = false;
  const absolute = relative => path.resolve(projectRoot, relative).split(path.sep).join('/');
  const publicVars = { ENVIRONMENT: 'production', STORAGE_PROVIDER: 'tigris', TIGRIS_ENDPOINT: 'https://t3.storage.dev',
    TIGRIS_REGION: 'auto', TIGRIS_BUCKET: settings.TIGRIS_BUCKET, GOOGLE_CLIENT_ID: settings.GOOGLE_CLIENT_ID };
  const lines = source.split(/\r?\n/).map(line => {
    if (/^\s*\[/.test(line)) section = line.trim();
    const field = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=/)?.[1];
    let value;
    if (!section && field === 'name') value = settings.WORKER_NAME;
    if (!section && field === 'main') value = absolute('apps/api/src/worker.ts');
    if (!section && field === 'account_id') value = settings.CLOUDFLARE_ACCOUNT_ID;
    if (section === '[assets]' && field === 'directory') value = absolute('apps/web/dist');
    if (section === '[vars]' && Object.hasOwn(publicVars, field)) {
      value = publicVars[field]; if (field === 'TIGRIS_BUCKET') changedBucket = true;
    }
    if (section === '[[d1_databases]]' && field === 'database_id') { value = settings.D1_DATABASE_ID; changedDb = true; }
    if (section === '[[d1_databases]]' && field === 'database_name') value = settings.D1_DATABASE_NAME;
    if (field === 'migrations_dir') value = absolute('database/migrations');
    return value === undefined ? line : `${field} = ${JSON.stringify(value)}`;
  });
  if (!changedDb || !changedBucket) throw new Error('Wrangler config đã đổi cấu trúc; cần review trước khi deploy.');
  return lines.join('\n');
}

export async function preflight(settings, request = fetch) {
  const account = settings.CLOUDFLARE_ACCOUNT_ID;
  async function cloudflare(endpoint, label) {
    let response;
    try {
      response = await request(`https://api.cloudflare.com/client/v4/accounts/${account}/${endpoint}`, {
        headers: { Authorization: `Bearer ${settings.CLOUDFLARE_API_TOKEN}` }, redirect: 'error', signal: AbortSignal.timeout(15000),
      });
    } catch { throw new Error(`${label}: không kết nối được Cloudflare.`); }
    if (!response.ok) throw new Error(`${label}: HTTP ${response.status}. Kiểm tra account/token/quyền hoặc tạo Worker bằng web trước.`);
    let body;
    try { body = await response.json(); }
    catch { throw new Error(`${label}: Cloudflare trả phản hồi không hợp lệ.`); }
    if (body.success !== true) throw new Error(`${label}: Cloudflare từ chối yêu cầu.`);
    return body.result;
  }
  const secrets = await cloudflare(`workers/scripts/${settings.WORKER_NAME}/secrets`, 'Kiểm tra Worker');
  const database = await cloudflare(`d1/database/${settings.D1_DATABASE_ID}`, 'Kiểm tra D1');
  if (!Array.isArray(secrets) || database?.name !== settings.D1_DATABASE_NAME) throw new Error('Thông tin Worker/D1 không khớp cấu hình local.');
  return { hasJwt: secrets.some(secret => secret.name === 'JWT_SECRET') };
}

export async function checkTigris(settings, request = fetch) {
  const { AwsClient } = apiRequire('aws4fetch');
  const client = new AwsClient({ accessKeyId: settings.TIGRIS_ACCESS_KEY_ID, secretAccessKey: settings.TIGRIS_SECRET_ACCESS_KEY, service: 's3', region: 'auto', retries: 0 });
  let response;
  try {
    const signed = await client.sign(`https://t3.storage.dev/${settings.TIGRIS_BUCKET}?list-type=2&max-keys=1`, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    response = await request(signed);
  } catch { throw new Error('Không kết nối được Tigris hoặc đã hết thời gian chờ; giữ bucket PRIVATE.'); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Tigris LIST: HTTP ${response.status}. Kiểm tra tên bucket, key và quyền đọc/liệt kê trên đúng bucket; giữ PRIVATE.`);
  }
  await response.body?.cancel();
}

export async function checkD1Write(settings, request = fetch) {
  // D1 Read permits SELECT and EXPLAIN, but migrations require D1 Edit.
  // Only --deploy runs this probe, before building or applying migrations.
  const table = `_gtt_deploy_check_${randomBytes(12).toString('hex')}`;
  async function query(sql) {
    let response;
    try {
      response = await request(`https://api.cloudflare.com/client/v4/accounts/${settings.CLOUDFLARE_ACCOUNT_ID}/d1/database/${settings.D1_DATABASE_ID}/query`, {
        method: 'POST', headers: { Authorization: `Bearer ${settings.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, params: [] }), redirect: 'error', signal: AbortSignal.timeout(15000),
      });
    } catch { throw new Error('Kiểm tra quyền ghi D1: không kết nối được Cloudflare.'); }
    let body;
    try { body = await response.json(); } catch { body = {}; }
    if (!response.ok || body.success !== true || !Array.isArray(body.result) || !body.result.every(item => item.success === true)) {
      throw new Error(`Kiểm tra quyền ghi D1: HTTP ${response.status}. Token cần Account → D1 → Edit trên đúng account.`);
    }
  }
  let failure;
  try { await query(`CREATE TABLE "${table}" (id INTEGER)`); }
  catch (error) { failure = error; }
  // Clean only our unique empty probe, including an uncertain CREATE timeout.
  try { await query(`DROP TABLE IF EXISTS "${table}"`); }
  catch {
    if (!failure) failure = new Error(`Không dọn được bảng kiểm tra D1 ${table}; dừng deploy để kiểm tra quyền/kết nối.`);
  }
  if (failure) throw failure;
}

function run(args, settings, { cloud = false, stdin, label = 'Chạy công cụ triển khai' } = {}) {
  console.log(`[deploy] ${label}`);
  const env = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG: 'info' };
  // Credentials come only from the private file; never pass runtime secrets into build processes.
  for (const key of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_BASE_URL',
    'CLOUDFLARE_ENV', 'CF_API_BASE_URL', 'CF_API_TOKEN', 'CF_API_KEY', 'CF_ACCOUNT_ID', 'JWT_SECRET', 'TIGRIS_ACCESS_KEY_ID', 'TIGRIS_SECRET_ACCESS_KEY']) delete env[key];
  env.CLOUDFLARE_API_BASE_URL = 'https://api.cloudflare.com/client/v4';
  if (cloud) Object.assign(env, { CLOUDFLARE_API_TOKEN: settings.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: settings.CLOUDFLARE_ACCOUNT_ID });
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', args, { cwd: root, env, shell: process.platform === 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    for (const stream of [child.stdout, child.stderr]) {
      let pending = '';
      stream.setEncoding('utf8');
      stream.on('data', chunk => {
        pending += chunk;
        const lines = pending.split('\n'); pending = lines.pop();
        for (const line of lines) process.stdout.write(redact(line, settings) + '\n');
      });
      stream.on('end', () => { if (pending) process.stdout.write(redact(pending, settings) + '\n'); });
    }
    child.on('error', () => reject(new Error('Không khởi động được pnpm; cần môi trường Node/pnpm trên máy triển khai.')));
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${label} thất bại với exit ${code}; chưa hoàn tất phát hành.`)));
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
  });
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.filter(value => ['--deploy', '--dry-run', '--check'].includes(value)).length > 1) throw new Error('Không dùng nhiều chế độ triển khai cùng lúc.');
  const fileIndex = argv.indexOf('--env-file');
  if (fileIndex >= 0 && (!argv[fileIndex + 1] || argv[fileIndex + 1].startsWith('--'))) throw new Error('Thiếu đường dẫn --env-file.');
  const known = new Set(['--deploy', '--dry-run', '--check', '--env-file']);
  if (argv.some((value, index) => !(fileIndex >= 0 && index === fileIndex + 1) && !known.has(value))) throw new Error('Tham số triển khai không hợp lệ.');
  const filename = fileIndex < 0 ? path.join(root, '.env.deploy.local') : path.resolve(argv[fileIndex + 1] || '');
  const mode = argv.includes('--deploy') ? 'deploy' : argv.includes('--dry-run') ? 'dry-run' : 'check';
  const settings = readSettings(filename);
  try {
    let hasJwt = false;
    if (mode !== 'dry-run') {
      console.log('[deploy] Kiểm tra Cloudflare Worker/D1 và Tigris');
      ({ hasJwt } = await preflight(settings));
      await checkTigris(settings);
      console.log('Đã kiểm tra Worker, D1 và quyền đọc/list bucket Tigris. Chưa xác minh quyền ghi/xóa Tigris.');
      if (mode === 'check') return;
      await checkD1Write(settings);
      console.log('Đã xác minh quyền ghi schema D1 và xóa bảng kiểm tra rỗng.');
    }
    const output = path.join(apiDir, '.wrangler/token-deploy');
    mkdirSync(output, { recursive: true });
    const config = path.join(output, 'wrangler.toml');
    writeFileSync(config, renderConfig(readFileSync(path.join(apiDir, 'wrangler.toml'), 'utf8'), settings));
    const relativeConfig = path.relative(root, config).split(path.sep).join('/');
    const wrangler = (...args) => ['--filter', '@gametuoitho/api', 'exec', 'npx', '--yes', 'wrangler@4', ...args,
      '--config', `../../${relativeConfig}`, '--env='];
    await run(['cf:build'], settings, { label: 'Build giao diện Web' });
    await run(wrangler('deploy', '--dry-run', '--outdir', '.wrangler/token-build'), settings, { label: 'Kiểm tra bundle Worker (dry-run)' });
    if (mode === 'dry-run') { console.log('Dry-run đạt: không gọi Cloudflare/Tigris, không migrate, không đặt secrets hoặc deploy.'); return; }
    await run(wrangler('d1', 'migrations', 'apply', 'DB', '--remote'), settings, { cloud: true, label: 'Áp dụng migration D1' });
    await run(wrangler('d1', 'execute', 'DB', '--remote', '--file', '../../database/seeds/0001_seed_data.sql'), settings, { cloud: true, label: 'Seed thể loại D1' });
    const runtimeSecrets = { TIGRIS_ACCESS_KEY_ID: settings.TIGRIS_ACCESS_KEY_ID, TIGRIS_SECRET_ACCESS_KEY: settings.TIGRIS_SECRET_ACCESS_KEY };
    if (settings.JWT_SECRET) runtimeSecrets.JWT_SECRET = settings.JWT_SECRET;
    else if (!hasJwt) { settings.JWT_SECRET = randomBytes(48).toString('base64url'); runtimeSecrets.JWT_SECRET = settings.JWT_SECRET; }
    await run(wrangler('secret', 'bulk'), settings, { cloud: true, stdin: JSON.stringify(runtimeSecrets), label: 'Cập nhật Worker secrets' });
    await run(wrangler('deploy'), settings, { cloud: true, label: 'Phát hành Worker và Static Assets' });
    console.log('Đã deploy bằng token. Cần smoke test website, upload/game riêng tư và CPU Workers Free trên môi trường thật.');
  } catch (error) { throw new Error(redact(error.message, settings)); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
