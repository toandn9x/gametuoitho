import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readSettings, renderConfig, redact, preflight, checkTigris, checkD1Write, main } from '../scripts/cf-deploy-token.mjs';

const settings = {
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'fixture-cloudflare-token-never-real',
  WORKER_NAME: 'fixture-worker', D1_DATABASE_ID: '12345678-1234-1234-1234-123456789abc', D1_DATABASE_NAME: 'fixture-d1',
  TIGRIS_BUCKET: 'fixture-private-bucket', TIGRIS_ACCESS_KEY_ID: 'fixture-access-never-real', TIGRIS_SECRET_ACCESS_KEY: 'fixture-secret-never-real',
  GOOGLE_CLIENT_ID: '', JWT_SECRET: 'fixture-jwt-secret-not-used-for-real-login',
};

test('private file is read without mutating process environment', () => {
  const tempRoot = os.tmpdir();
  const directory = mkdtempSync(path.join(tempRoot, 'gtt-deploy-test-'));
  try {
    const filename = path.join(directory, '.env.deploy.local');
    writeFileSync(filename, Object.entries(settings).map(([key, value]) => `${key}=${value}`).join('\n'));
    const before = { ...process.env };
    assert.deepEqual(readSettings(filename), settings);
    const after = { ...process.env };
    assert(Object.keys(after).length === Object.keys(before).length && Object.keys(before).every(key => after[key] === before[key]),
      'Reading the private file must not mutate process.env');
    writeFileSync(filename, 'CLOUDFLARE_API_TOKEN=fixture-sensitive-value\n');
    assert.throws(() => readSettings(filename), error => !error.message.includes('fixture-sensitive-value') && /Cần điền/.test(error.message));
  } finally {
    assert.equal(path.dirname(directory), path.resolve(tempRoot));
    assert(path.basename(directory).startsWith('gtt-deploy-test-'));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('temporary config changes only public production values, preserves local and contains no keys', () => {
  const source = readFileSync(new URL('../apps/api/wrangler.toml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const originalLocal = source.slice(source.indexOf('[env.local.vars]')).replace(/migrations_dir\s*=.*/g, 'migrations_dir=normalized');
  const rendered = renderConfig(source, settings);
  assert(rendered.includes(`name = "${settings.WORKER_NAME}"`));
  assert(rendered.includes(`database_id = "${settings.D1_DATABASE_ID}"`));
  assert(rendered.includes(`TIGRIS_BUCKET = "${settings.TIGRIS_BUCKET}"`));
  for (const key of ['CLOUDFLARE_API_TOKEN', 'TIGRIS_ACCESS_KEY_ID', 'TIGRIS_SECRET_ACCESS_KEY', 'JWT_SECRET']) assert(!rendered.includes(settings[key]));
  assert.equal(rendered.slice(rendered.indexOf('[env.local.vars]')).replace(/migrations_dir\s*=.*/g, 'migrations_dir=normalized'), originalLocal);
  assert.throws(() => renderConfig('[vars]\nSTORAGE_PROVIDER="tigris"', settings), /đổi cấu trúc/);
});

test('redaction hides every credential', () => {
  const values = ['CLOUDFLARE_API_TOKEN', 'TIGRIS_ACCESS_KEY_ID', 'TIGRIS_SECRET_ACCESS_KEY', 'JWT_SECRET'].map(key => settings[key]);
  const result = redact(values.join('\n'), settings);
  assert(values.every(value => !result.includes(value)));
  assert.equal(result.split('[REDACTED]').length, 5);
});

test('preflight is read-only and preserves an existing JWT without reading its value', async () => {
  const requests = [];
  const result = await preflight(settings, async (url, options) => {
    requests.push(url); assert.equal(options.method, undefined); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${settings.CLOUDFLARE_API_TOKEN}`);
    const data = url.endsWith('/secrets') ? [{ name: 'JWT_SECRET', type: 'secret_text' }] : { name: settings.D1_DATABASE_NAME };
    return Response.json({ success: true, result: data });
  });
  assert.deepEqual(result, { hasJwt: true });
  assert.equal(requests.length, 2);
  assert(requests.every(url => url.startsWith(`https://api.cloudflare.com/client/v4/accounts/${settings.CLOUDFLARE_ACCOUNT_ID}/`)));
});

test('preflight stops on account/token rejection and never prints upstream secret text', async () => {
  let calls = 0;
  await assert.rejects(preflight(settings, async () => { calls++; return new Response(settings.CLOUDFLARE_API_TOKEN, { status: 403 }); }),
    error => /403/.test(error.message) && !error.message.includes(settings.CLOUDFLARE_API_TOKEN));
  assert.equal(calls, 1);
});

test('preflight rejects a mismatched database or provider failure', async () => {
  await assert.rejects(preflight(settings, async url => Response.json({ success: true, result: url.endsWith('/secrets') ? [] : { name: 'wrong-db' } })), /không khớp/);
  await assert.rejects(preflight(settings, async () => Response.json({ success: false })), /từ chối/);
  await assert.rejects(preflight(settings, async () => { throw new Error(settings.CLOUDFLARE_API_TOKEN); }),
    error => !error.message.includes(settings.CLOUDFLARE_API_TOKEN));
  await assert.rejects(preflight(settings, async () => new Response(settings.CLOUDFLARE_API_TOKEN)),
    error => /không hợp lệ/.test(error.message) && !error.message.includes(settings.CLOUDFLARE_API_TOKEN));
});

test('CLI rejects conflicting or missing arguments before reading credentials', async () => {
  await assert.rejects(main(['--deploy', '--dry-run']), /Không dùng/);
  await assert.rejects(main(['--deploy', '--check']), /Không dùng/);
  await assert.rejects(main(['--env-file']), /Thiếu/);
  await assert.rejects(main(['--wrong']), /không hợp lệ/);
  await assert.rejects(main(['--deploy', '--allow-unavailable-storage']), /không hợp lệ/);
});

test('Tigris preflight signs a read request and reports HTTP 403 without upstream secrets', async () => {
  await assert.rejects(checkTigris(settings, async request => {
    assert.equal(request.method, 'GET');
    assert.equal(new URL(request.url).searchParams.get('max-keys'), '1');
    assert(request.headers.get('Authorization').startsWith('AWS4-HMAC-SHA256'));
    return new Response(settings.TIGRIS_SECRET_ACCESS_KEY, { status: 403 });
  }), error => /HTTP 403/.test(error.message) && !error.message.includes(settings.TIGRIS_SECRET_ACCESS_KEY));
  await checkTigris(settings, async () => new Response('<ListBucketResult/>'));
});

test('D1 write check creates and deletes only its own unique empty table', async () => {
  const statements = [];
  await checkD1Write(settings, async (url, options) => {
    assert(url.endsWith(`/${settings.D1_DATABASE_ID}/query`));
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    statements.push(JSON.parse(options.body).sql);
    return Response.json({ success: true, result: [{ success: true }] });
  });
  const match = statements[0].match(/^CREATE TABLE "(_gtt_deploy_check_[a-f0-9]{24})" \(id INTEGER\)$/);
  assert(match);
  assert.deepEqual(statements, [statements[0], `DROP TABLE IF EXISTS "${match[1]}"`]);
});

test('D1 write check stops on rejection, hides upstream secrets and attempts cleanup', async () => {
  const requests = [];
  await assert.rejects(checkD1Write(settings, async (_, options) => {
    requests.push(JSON.parse(options.body).sql);
    return new Response(settings.CLOUDFLARE_API_TOKEN, { status: 400 });
  }), error => /D1 → Edit/.test(error.message) && !error.message.includes(settings.CLOUDFLARE_API_TOKEN));
  assert.equal(requests.length, 2);
  assert(requests[1].startsWith('DROP TABLE IF EXISTS "_gtt_deploy_check_'));
  await assert.rejects(checkD1Write(settings, async (_, options) => options.body.includes('CREATE TABLE')
    ? Response.json({ success: true, result: [{ success: true }] })
    : Response.json({ success: false, errors: [{ message: settings.CLOUDFLARE_API_TOKEN }] })),
  error => /Không dọn được/.test(error.message) && !error.message.includes(settings.CLOUDFLARE_API_TOKEN));
});
