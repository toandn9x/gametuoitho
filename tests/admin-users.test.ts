import assert from 'node:assert/strict';
import type { DatabaseClient } from '../apps/api/src/repositories/db';

export async function runAdminUsersTests(
  request: (path: string, options?: RequestInit) => Promise<Response>,
  db: DatabaseClient,
  adminToken: string,
  memberToken: string
) {
  const adminHeaders = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };
  const memberHeaders = { Authorization: `Bearer ${memberToken}`, 'Content-Type': 'application/json' };
  const endpoint = '/api/v1/admin/users';

  for (const [headers, expected] of [[{}, 401], [memberHeaders, 403]] as const) {
    assert.equal((await request(endpoint, { headers })).status, expected);
    assert.equal((await request(`${endpoint}/usr-player-01/status`, {
      method: 'PUT', headers, body: JSON.stringify({ status: 'BLOCKED' }),
    })).status, expected);
  }

  // Dedicated fixtures keep session-revocation checks independent of other suites.
  const accounts = [];
  for (const username of ['managed_member_a', 'managed_member_b']) {
    const response = await request('/api/v1/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email: `${username}@fixture.invalid`, password: 'Synthetic-test-password-123' }),
    });
    assert.equal(response.status, 201);
    accounts.push((await response.json()).data);
  }
  const target = accounts[0].user;
  const targetToken = accounts[0].token;
  const statusUrl = `${endpoint}/${target.id}/status`;
  const list = async (query = '') => {
    const response = await request(`${endpoint}${query}`, { headers: adminHeaders });
    assert.equal(response.status, 200);
    return response.json();
  };
  const update = (status: string) => request(statusUrl, {
    method: 'PUT', headers: adminHeaders, body: JSON.stringify({ status }),
  });
  const assertSafeAccount = (user: Record<string, unknown>) => {
    assert.deepEqual(Object.keys(user).sort(), ['id', 'username', 'email', 'role', 'status', 'created_at', 'updated_at'].sort());
  };

  const first = await list('?search=managed_member_&limit=1');
  const second = await list('?search=managed_member_&limit=1&page=2');
  assert.deepEqual(first.pagination, { page: 1, limit: 1, total: 2, totalPages: 2 });
  assert.equal(first.data.length, 1);
  assert.equal(second.data.length, 1);
  assert.notEqual(first.data[0].id, second.data[0].id, 'Pagination must not repeat accounts');
  first.data.forEach(assertSafeAccount);
  assert.equal((await list('?search=MANAGED_MEMBER_A%40FIXTURE.INVALID')).data[0].id, target.id);
  assert.equal((await list('?search=managed_member_&role=USER&status=ACTIVE')).pagination.total, 2);
  assert.equal((await list('?search=managed_member_&role=ADMIN')).pagination.total, 0);
  assert.equal((await list('?search=managed_member_&status=BLOCKED')).pagination.total, 0);
  for (const query of ['?search=%25', '?search=%27%20OR%201%3D1--', '?search=%5C', '?search=no-such-account']) {
    assert.deepEqual((await list(query)).data, []);
  }
  assert.deepEqual((await list('?page=1000000')).data, []);
  for (const query of ['?page=0', '?page=-1', '?page=1.5', '?page=NaN', '?page=1000001', '?limit=0', '?limit=101', '?limit=1.5', '?role=OWNER', '?status=DELETED', `?search=${'x'.repeat(101)}`]) {
    assert.equal((await request(`${endpoint}${query}`, { headers: adminHeaders })).status, 400, query);
  }

  assert.equal((await update('DELETED')).status, 400);
  for (const body of ['{', '{}', JSON.stringify({ status: 'ACTIVE', role: 'ADMIN' })]) {
    assert.equal((await request(statusUrl, { method: 'PUT', headers: adminHeaders, body })).status, 400);
  }
  assert.equal((await request(`${endpoint}/missing-user/status`, {
    method: 'PUT', headers: adminHeaders, body: JSON.stringify({ status: 'BLOCKED' }),
  })).status, 404);
  await db.execute("INSERT INTO users (id, username, email, password_hash, role) VALUES (?, ?, ?, ?, 'ADMIN')", [
    'managed-other-admin', 'managed_other_admin', 'other-admin@fixture.invalid', 'unused-test-hash',
  ]);
  for (const id of ['usr-admin-01', 'managed-other-admin']) {
    assert.equal((await request(`${endpoint}/${id}/status`, {
      method: 'PUT', headers: adminHeaders, body: JSON.stringify({ status: 'BLOCKED' }),
    })).status, 403, 'Admin accounts must be protected');
  }

  const blocked = await update('BLOCKED');
  assert.equal(blocked.status, 200);
  const blockedUser = (await blocked.json()).data;
  assertSafeAccount(blockedUser);
  assert.equal(blockedUser.status, 'BLOCKED');
  assert.equal((await list('?search=managed_member_&status=BLOCKED')).pagination.total, 1);
  assert.equal((await request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${targetToken}` } })).status, 401);
  const login = () => request('/api/v1/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernameOrEmail: target.username, password: 'Synthetic-test-password-123' }),
  });
  assert.equal((await login()).status, 401, 'Blocked members cannot sign in');
  const version = await db.queryFirst<{ token_version: number }>('SELECT token_version FROM users WHERE id = ?', [target.id]);
  assert.equal(version?.token_version, 1);
  assert.equal((await update('BLOCKED')).status, 200);
  assert.deepEqual(await db.queryFirst('SELECT token_version FROM users WHERE id = ?', [target.id]), version, 'Idempotent status writes must not revoke extra sessions');
  assert.equal((await update('ACTIVE')).status, 200);
  assert.equal((await request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${targetToken}` } })).status, 401, 'Unblocking must not revive an old token');
  const newLogin = await login();
  assert.equal(newLogin.status, 200);
  const newToken = (await newLogin.json()).data.token;
  assert.equal((await request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${newToken}` } })).status, 200);
  const audit = await db.query<{ action: string }>("SELECT action FROM audit_logs WHERE target_type = 'USER' AND target_id = ?", [target.id]);
  assert.deepEqual(audit.map((entry) => entry.action), ['UPDATE_USER_STATUS', 'UPDATE_USER_STATUS']);
  assert.equal((await request('/api/v1/admin/imports', { headers: adminHeaders })).status, 200, 'Game import management remains a separate endpoint');
}
