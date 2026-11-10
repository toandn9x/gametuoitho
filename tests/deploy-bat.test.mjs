import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const windows = process.platform === 'win32';
const batch = fileURLToPath(new URL('../deploy.bat', import.meta.url));
const helperUrl = new URL('../scripts/cf-deploy-token.mjs', import.meta.url).href;
const fixtureSecret = 'fixture-bat-secret-never-real';

function runBatch({ helperExit = 0, installExit = 0, mode = '--check', missingEnv = false } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'gtt deploy bat test '));
  try {
    mkdirSync(path.join(directory, 'bin'));
    mkdirSync(path.join(directory, 'scripts'));
    copyFileSync(batch, path.join(directory, 'deploy.bat'));
    if (!missingEnv) writeFileSync(path.join(directory, '.env.deploy.local'), '# No real credentials\n');
    writeFileSync(path.join(directory, 'bin', 'pnpm.cmd'), [
      '@echo off',
      'if "%~1"=="--version" (echo 10.0.0& exit /b 0)',
      'if not "%~1"=="install" exit /b 98',
      'if not "%~2"=="--frozen-lockfile" exit /b 99',
      'echo FIXTURE_INSTALL',
      'exit /b %GTT_FIXTURE_INSTALL_EXIT%',
      '',
    ].join('\r\n'));
    // Replace all cloud operations with a fixture; reuse the real redactor.
    writeFileSync(path.join(directory, 'scripts', 'cf-deploy-token.mjs'), `
      import { redact } from ${JSON.stringify(helperUrl)};
      console.log('FIXTURE_HELPER_RUN ' + process.argv[2]);
      console.log('Tiếng Việt: kiểm tra log UTF-8');
      console.log(redact(${JSON.stringify(fixtureSecret)}, { CLOUDFLARE_API_TOKEN: ${JSON.stringify(fixtureSecret)} }));
      console.error('fixture stderr preserved');
      process.exitCode = Number(process.env.GTT_FIXTURE_HELPER_EXIT);
    `);
    const env = { ...process.env, GTT_FIXTURE_HELPER_EXIT: String(helperExit), GTT_FIXTURE_INSTALL_EXIT: String(installExit) };
    const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'Path';
    env[pathKey] = path.join(directory, 'bin') + path.delimiter + (env[pathKey] || '');
    const result = spawnSync(process.env.ComSpec || 'cmd.exe', [
      '/d', '/s', '/c', `""${path.join(directory, 'deploy.bat')}" ${mode} --no-pause"`,
    ], { cwd: os.tmpdir(), env, windowsHide: true, windowsVerbatimArguments: true, encoding: 'utf8', timeout: 30000 });
    assert.ifError(result.error);
    const logDir = path.join(directory, 'logs', 'deploy');
    const files = readdirSync(logDir).filter(name => name.endsWith('.log'));
    assert.equal(files.length, 1, 'Each invocation should produce one log');
    const log = readFileSync(path.join(logDir, files[0]), 'utf8');
    return { status: result.status, output: (result.stdout || '') + (result.stderr || ''), log };
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert(path.basename(directory).startsWith('gtt deploy bat test '));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('deploy.bat anchors paths, streams UTF-8 stdout/stderr and saves redacted logs', { skip: !windows }, () => {
  const result = runBatch({ mode: '--DRY-RUN' });
  assert.equal(result.status, 0, result.output);
  assert(result.output.includes('FIXTURE_HELPER_RUN --dry-run'));
  assert(result.output.includes('fixture stderr preserved'));
  assert(result.log.includes('Tiếng Việt: kiểm tra log UTF-8'));
  assert(result.log.includes('fixture stderr preserved'));
  assert(result.log.includes('[REDACTED]'));
  assert(!result.log.includes(fixtureSecret));
  assert(result.log.includes('SUCCESS: --dry-run completed. Exit code: 0.'));
});

test('deploy.bat retains helper failure status and the failed stage in its log', { skip: !windows }, () => {
  const result = runBatch({ helperExit: 17 });
  assert.equal(result.status, 17, result.output);
  assert(result.log.includes('fixture stderr preserved'));
  assert(result.log.includes('FAILED at [3/3] Run deployment helper'));
  assert(result.log.includes('Exit code: 17'));
  assert(!result.log.includes('SUCCESS:'));
});

test('deploy.bat defaults to deploy when no mode is supplied', { skip: !windows }, () => {
  const result = runBatch({ mode: '' });
  assert.equal(result.status, 0, result.output);
  assert(result.log.includes('FIXTURE_HELPER_RUN --deploy'));
  assert(result.log.includes('SUCCESS: --deploy completed. Exit code: 0.'));
});

test('deploy.bat stops before the helper when dependency installation fails', { skip: !windows }, () => {
  const result = runBatch({ installExit: 23 });
  assert.equal(result.status, 23, result.output);
  assert(result.log.includes('FAILED at [2/3] Install dependencies'));
  assert(!result.log.includes('FIXTURE_HELPER_RUN'));
});

test('deploy.bat logs missing configuration without installing or contacting cloud', { skip: !windows }, () => {
  const result = runBatch({ missingEnv: true });
  assert.equal(result.status, 1, result.output);
  assert(result.log.includes('Missing .env.deploy.local'));
  assert(!result.log.includes('FIXTURE_INSTALL'));
  assert(!result.log.includes('FIXTURE_HELPER_RUN'));
});
