/**
 * Sign in with Google: ID-token verification + /api/v1/auth/google account handling.
 * A locally generated RSA key plays the role of Google's signing key; its public JWK is served
 * through a data: URL via GOOGLE_JWKS_URL, so no network access is needed.
 * Run: pnpm --filter @gametuoitho/api test   (or: tsx tests/google-auth.test.ts)
 */
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { createApp } from '../apps/api/src/index';
import { SqliteDatabaseClient } from '../apps/api/src/repositories/db';
import { LocalStorageDriver } from '../apps/api/src/storage/storage';
import { runMigrations } from '../apps/api/src/repositories/migrationRunner';
import { verifyGoogleIdToken, GoogleTokenError } from '../apps/api/src/services/googleIdToken';
import { GOOGLE_ONLY_PASSWORD_HASH } from '../apps/api/src/services/authService';

const CLIENT_ID = 'test-client-1234.apps.googleusercontent.com';
const KID = 'test-key-1';

const b64url = (bytes: Uint8Array | string) =>
  Buffer.from(typeof bytes === 'string' ? Buffer.from(bytes) : bytes).toString('base64url');

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`   ✓ ${name}`);
}

async function main() {
  console.log('Google sign-in tests...');

  const keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
  const otherKeyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const jwksUrl = `data:application/json,${encodeURIComponent(JSON.stringify({ keys: [{ ...publicJwk, kid: KID, use: 'sig', alg: 'RS256' }] }))}`;

  const now = Math.floor(Date.now() / 1000);
  const claims = (overrides: Record<string, unknown> = {}) => ({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '109876543210987654321',
    email: 'Nguyen.Van.A@gmail.com',
    email_verified: true,
    name: 'Nguyễn Văn A',
    iat: now - 10,
    exp: now + 3600,
    ...overrides,
  });
  const sign = async (payload: object, opts: { kid?: string; alg?: string; key?: CryptoKey } = {}) => {
    const header = b64url(JSON.stringify({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? KID, typ: 'JWT' }));
    const body = b64url(JSON.stringify(payload));
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', opts.key ?? keyPair.privateKey, new TextEncoder().encode(`${header}.${body}`));
    return `${header}.${body}.${b64url(new Uint8Array(sig))}`;
  };
  const rejects = async (token: string, pattern?: RegExp) => {
    await assert.rejects(verifyGoogleIdToken(token, CLIENT_ID, { jwksUrl }), (err: unknown) => {
      assert.ok(err instanceof GoogleTokenError, `expected GoogleTokenError, got ${err}`);
      if (pattern) assert.match((err as Error).message, pattern);
      return true;
    });
  };

  // --- token verification ---
  await test('valid token → identity (email lower-cased)', async () => {
    const identity = await verifyGoogleIdToken(await sign(claims()), CLIENT_ID, { jwksUrl });
    assert.deepEqual(identity, { sub: '109876543210987654321', email: 'nguyen.van.a@gmail.com', name: 'Nguyễn Văn A' });
  });
  await test('issuer without https:// is accepted', async () => {
    await verifyGoogleIdToken(await sign(claims({ iss: 'accounts.google.com' })), CLIENT_ID, { jwksUrl });
  });
  await test('wrong audience rejected', async () => rejects(await sign(claims({ aud: 'someone-else.apps.googleusercontent.com' }))));
  await test('wrong issuer rejected', async () => rejects(await sign(claims({ iss: 'https://evil.example' }))));
  await test('expired token rejected', async () => rejects(await sign(claims({ exp: now - 3600, iat: now - 7200 })), /hết hạn/));
  await test('token issued in the future rejected', async () => rejects(await sign(claims({ iat: now + 3600 }))));
  await test('unverified email rejected', async () => rejects(await sign(claims({ email_verified: false })), /chưa xác minh/));
  await test('missing sub rejected', async () => rejects(await sign(claims({ sub: '' }))));
  await test('signature from another key rejected', async () => rejects(await sign(claims(), { key: otherKeyPair.privateKey })));
  await test('tampered payload rejected', async () => {
    const [h, , s] = (await sign(claims())).split('.');
    await rejects(`${h}.${b64url(JSON.stringify(claims({ email: 'attacker@gmail.com' })))}.${s}`);
  });
  await test('alg "none" / HS256 rejected', async () => {
    const payload = b64url(JSON.stringify(claims()));
    await rejects(`${b64url(JSON.stringify({ alg: 'none', kid: KID }))}.${payload}.`);
    await rejects(`${b64url(JSON.stringify({ alg: 'HS256', kid: KID }))}.${payload}.${b64url('x')}`);
  });
  await test('unknown key id rejected', async () => rejects(await sign(claims(), { kid: 'not-a-google-key' })));
  await test('malformed tokens rejected', async () => {
    for (const bad of ['', 'abc', 'a.b', 'a.b.c', `${b64url('{')}.${b64url('{}')}.x`]) await rejects(bad);
  });

  // --- API: /auth/config and /auth/google ---
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-google-'));
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = new SqliteDatabaseClient(sqlite);
  runMigrations(db, path.resolve(__dirname, '../database/migrations'));
  const app = createApp(db, new LocalStorageDriver(path.join(workDir, 'uploads')));
  const baseEnv = { JWT_SECRET: 'google-test-secret-0123456789abcdefghijklmnopqrstuv', ENVIRONMENT: 'production', DB: null, BUCKET: null, _dbClient: db };
  const call = async (method: string, url: string, body?: unknown, env: Record<string, unknown> = { ...baseEnv, GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_JWKS_URL: jwksUrl }, token?: string) => {
    const res = await app.fetch(
      new Request(`http://localhost${url}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env
    );
    return { status: res.status, json: (await res.json()) as any };
  };

  try {
    await test('config: client id published when configured, null when not', async () => {
      assert.equal((await call('GET', '/api/v1/auth/config')).json.data.googleClientId, CLIENT_ID);
      assert.equal((await call('GET', '/api/v1/auth/config', undefined, baseEnv)).json.data.googleClientId, null);
    });

    await test('google login disabled without client id → 503', async () => {
      const res = await call('POST', '/api/v1/auth/google', { credential: await sign(claims()) }, baseEnv);
      assert.equal(res.status, 503);
      assert.equal(res.json.error.code, 'GOOGLE_NOT_CONFIGURED');
    });

    await test('missing / oversized credential → 400', async () => {
      assert.equal((await call('POST', '/api/v1/auth/google', {})).status, 400);
      assert.equal((await call('POST', '/api/v1/auth/google', { credential: 'x'.repeat(9000) })).status, 400);
    });

    let firstUserId = '';
    let firstToken = '';
    await test('first Google sign-in creates a USER account and a working session', async () => {
      const res = await call('POST', '/api/v1/auth/google', { credential: await sign(claims()) });
      assert.equal(res.status, 200, JSON.stringify(res.json));
      const { user, token } = res.json.data;
      assert.equal(user.username, 'nguyenvana');
      assert.equal(user.email, 'nguyen.van.a@gmail.com');
      assert.equal(user.role, 'USER');
      assert.equal(user.password_hash, undefined, 'password hash must not be returned');
      assert.equal(user.google_sub, undefined, 'google id must not be returned');
      const me = await call('GET', '/api/v1/auth/me', undefined, undefined, token);
      assert.equal(me.status, 200);
      assert.equal(me.json.data.id, user.id);
      assert.equal(me.json.data.google_sub, undefined);
      firstUserId = user.id;
      firstToken = token;
      const row = sqlite.prepare('SELECT google_sub, password_hash FROM users WHERE id = ?').get(user.id) as any;
      assert.equal(row.google_sub, '109876543210987654321');
      assert.equal(row.password_hash, GOOGLE_ONLY_PASSWORD_HASH);
    });

    await test('second sign-in with the same Google account → same user', async () => {
      const res = await call('POST', '/api/v1/auth/google', { credential: await sign(claims({ email: 'renamed@gmail.com' })) });
      assert.equal(res.status, 200);
      assert.equal(res.json.data.user.id, firstUserId);
      assert.ok(firstToken);
    });

    await test('password login on a Google-only account → clear message, no session', async () => {
      const res = await call('POST', '/api/v1/auth/login', { usernameOrEmail: 'nguyenvana', password: GOOGLE_ONLY_PASSWORD_HASH });
      assert.equal(res.status, 401);
      assert.match(res.json.error.message, /Google/);
    });

    await test('username collision → suffixed username', async () => {
      const res = await call('POST', '/api/v1/auth/google', { credential: await sign(claims({ sub: 'sub-2', email: 'nguyen.van.a@googlemail.com' })) });
      assert.equal(res.status, 200);
      assert.match(res.json.data.user.username, /^nguyenvana_\d{4}$/);
    });

    await test('short / unusual email local part → valid username', async () => {
      const res = await call('POST', '/api/v1/auth/google', { credential: await sign(claims({ sub: 'sub-3', email: 'a.b@gmail.com' })) });
      assert.equal(res.status, 200);
      assert.match(res.json.data.user.username, /^[a-zA-Z0-9_-]{3,30}$/);
    });

    await test('email of an existing password account → 409, account not linked', async () => {
      const reg = await call('POST', '/api/v1/auth/register', { username: 'pwuser', email: 'pwuser@gmail.com', password: 'Strong-password-123' });
      assert.equal(reg.status, 201);
      const res = await call('POST', '/api/v1/auth/google', { credential: await sign(claims({ sub: 'sub-4', email: 'PwUser@gmail.com' })) });
      assert.equal(res.status, 409);
      assert.equal(res.json.error.code, 'EMAIL_ALREADY_REGISTERED');
      const row = sqlite.prepare("SELECT google_sub FROM users WHERE username = 'pwuser'").get() as any;
      assert.equal(row.google_sub, null);
    });

    await test('blocked account cannot sign in with Google', async () => {
      sqlite.prepare("UPDATE users SET status = 'BLOCKED' WHERE id = ?").run(firstUserId);
      const res = await call('POST', '/api/v1/auth/google', { credential: await sign(claims()) });
      assert.equal(res.status, 403);
      sqlite.prepare("UPDATE users SET status = 'ACTIVE' WHERE id = ?").run(firstUserId);
    });

    await test('invalid Google token → 400 and no account created', async () => {
      const before = (sqlite.prepare('SELECT COUNT(*) AS n FROM users').get() as any).n;
      const res = await call('POST', '/api/v1/auth/google', { credential: await sign(claims({ sub: 'sub-5', email: 'new@gmail.com', aud: 'other' })) });
      assert.equal(res.status, 400);
      assert.equal(res.json.error.code, 'GOOGLE_TOKEN_INVALID');
      assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM users').get() as any).n, before);
    });

    await test('regular register / login still work', async () => {
      const res = await call('POST', '/api/v1/auth/login', { usernameOrEmail: 'pwuser', password: 'Strong-password-123' });
      assert.equal(res.status, 200);
      assert.equal(res.json.data.user.password_hash, undefined);
    });
  } finally {
    sqlite.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  console.log(`Google sign-in: ${passed} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
