// Built admin page against local API fixtures; no real account, database or cloud writes.
// Run after pnpm cf:build; PLAYWRIGHT_MODULE_PATH may point to an existing installation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const dist = path.resolve(__dirname, '../../apps/web/dist');
const featured = { id: 'featured', name: 'Featured fixture', slug: 'featured', is_featured: true, status: 'PUBLISHED', visibility: 'PUBLIC' };
const other = { ...featured, id: 'other', slug: 'other', name: 'Other fixture', is_featured: false };

async function reviewPersonalState(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const errors = [], dialogs = [], heldReads = [], heldDeletes = [], requests = [];
  const holdAccounts = new Set();
  const imports = {
    a: [1, 2, 3].map(index => ({ id: `a-${index}`, source_type: 'CUSTOM', custom_name: `Private A ${index}`, custom_original_filename: 'a.jar', jar_url: '/fixture.jar', created_at: '2026-11-11T00:00:00Z' })),
    b: [{ id: 'b-1', source_type: 'CUSTOM', custom_name: 'Private B 1', custom_original_filename: 'b.jar', jar_url: '/fixture.jar', created_at: '2026-11-11T00:00:00Z' }],
  };
  let failImport = false;
  const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? { success: true, data } : { success: false, error: { message: 'Fixture request rejected' } }) });
  const dataFor = (account, endpoint) => endpoint === '/api/v1/auth/me'
    ? { id: account, username: `Account ${account.toUpperCase()}`, role: account === 'a' ? 'ADMIN' : 'USER' }
    : imports[account].map(item => ({ ...item }));
  try {
    await context.route('**/*', route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const account = req.headers().authorization?.replace('Bearer account-', '');
      requests.push({ endpoint: url.pathname, method: req.method(), account });
      if (url.pathname === '/api/v1/auth/config') return json(route, { googleClientId: null });
      if (!imports[account]) return json(route, null, 401);
      if (req.method() === 'GET' && ['/api/v1/auth/me', '/api/v1/me/library', '/api/v1/me/imports'].includes(url.pathname)) {
        const data = dataFor(account, url.pathname);
        if (holdAccounts.has(account)) { heldReads.push({ route, account, endpoint: url.pathname, data }); return; }
        return json(route, data);
      }
      if (req.method() === 'DELETE' && url.pathname.startsWith('/api/v1/me/library/')) {
        heldDeletes.push({ route, account, id: url.pathname.split('/').pop() }); return;
      }
      if (req.method() === 'POST' && url.pathname === '/api/v1/upload') return json(route, { id: 'fixture-asset', storage_key: 'fixture.jar' });
      if (req.method() === 'POST' && url.pathname === '/api/v1/me/imports') {
        if (failImport) return json(route, null, 400);
        const data = req.postDataJSON();
        imports[account].push({ ...imports.b[0], id: 'new-' + account, custom_name: data.custom_name });
        return json(route, { id: 'new-' + account });
      }
      return json(route, []);
    });
    const writer = await context.newPage(), page = await context.newPage();
    for (const [source, tab] of [['personal', page], ['writer', writer]]) tab.on('pageerror', error => {
      const detail = { source, url: tab.url(), message: error.message, stack: error.stack };
      errors.push(detail); console.log('BROWSER ERROR ' + JSON.stringify(detail));
    });
    page.on('dialog', async dialog => { dialogs.push({ type: dialog.type(), message: dialog.message() }); await dialog.accept(); });
    page.setDefaultTimeout(5000);
    await writer.goto(origin + '/404.html');
    const switchAccount = account => writer.evaluate(value => {
      if (value) localStorage.setItem('gametuoitho_token', 'account-' + value);
      else localStorage.removeItem('gametuoitho_token');
    }, account);
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const waitReads = async account => {
      for (let i = 0; heldReads.filter(read => read.account === account).length < 2 && i < 500; i++) await page.waitForTimeout(10);
      assert.equal(heldReads.filter(read => read.account === account).length, 2, 'header and personal list must refresh');
    };
    const releaseReads = async (account, rejectUser = false) => {
      for (const read of heldReads.filter(read => read.account === account)) await json(read.route, read.data, rejectUser && read.endpoint === '/api/v1/auth/me' ? 401 : 200);
      heldReads.splice(0, heldReads.length, ...heldReads.filter(read => read.account !== account));
      holdAccounts.delete(account);
      await settle();
    };
    const waitDeletes = async count => {
      for (let i = 0; heldDeletes.length < count && i < 500; i++) await page.waitForTimeout(10);
      assert.equal(heldDeletes.length, count);
    };
    const releaseDelete = async (index, success = true) => {
      const deletion = heldDeletes[index];
      const name = imports[deletion.account].find(item => item.id === deletion.id)?.custom_name;
      if (success) imports[deletion.account] = imports[deletion.account].filter(item => item.id !== deletion.id);
      await json(deletion.route, {}, success ? 200 : 400);
      if (success) await page.getByText(name, { exact: true }).waitFor({ state: 'detached' });
      await settle();
    };
    await switchAccount('a');
    await page.goto(origin + '/me/library/');
    await page.getByText('Private A 1', { exact: true }).waitFor();
    await page.locator('button[title="Account A"]').click();
    await page.getByText('Trang Quản Trị (Admin)', { exact: false }).waitFor();
    holdAccounts.add('a'); holdAccounts.add('b');
    await page.evaluate(() => window.dispatchEvent(new Event('gtt:auth-changed')));
    await waitReads('a');
    await switchAccount('b'); await waitReads('b');
    await page.getByText('Private A 1', { exact: true }).waitFor({ state: 'detached' });
    assert.equal(await page.getByText('Private A 1', { exact: true }).count(), 0);
    assert.equal(await page.locator('button[title="Account A"]').count(), 0);
    assert.equal(await page.getByText('Trang Quản Trị (Admin)', { exact: false }).count(), 0);
    await releaseReads('a', true); // Late 401 for A must not log B out or restore A's cards.
    assert.equal(await page.locator('.game-card').count(), 0);
    assert.equal(new URL(page.url()).pathname, '/me/library/');
    assert.equal(await page.evaluate(() => localStorage.getItem('gametuoitho_token')), 'account-b');
    await releaseReads('b');
    await page.getByText('Private B 1', { exact: true }).waitFor();
    await page.locator('button[title="Account B"]').waitFor();
    console.log('PASS real cross-tab account change clears private cards/admin menu; late A response/401 cannot overwrite or log out B');

    await switchAccount(null);
    await page.waitForURL('**/login?**');
    assert.equal(await page.getByText('Private B 1', { exact: true }).count(), 0);
    assert.equal(await page.locator('button[title="Account B"]').count(), 0);
    assert.equal(new URL(page.url()).searchParams.get('reason'), 'login');
    console.log('PASS cross-tab logout removes private data and retains the protected-page login redirect');

    await switchAccount('a');
    // Let the login page finish its auth refresh before navigating again. WebKit
    // otherwise reports the deliberately interrupted fetch as an access-control error.
    await page.locator('button[title="Account A"]').waitFor();
    await page.goto(origin + '/me/imports/');
    await page.getByText('Private A 1', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Xóa', exact: true }).nth(0).click(); await waitDeletes(1);
    await page.getByRole('button', { name: 'Xóa', exact: true }).nth(1).click(); await waitDeletes(2);
    await releaseDelete(1); await releaseDelete(0);
    assert.equal(await page.getByText('Private A 1', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Private A 2', { exact: true }).count(), 0);
    await page.getByText('Private A 3', { exact: true }).waitFor();
    assert.ok((await page.getByRole('heading', { level: 2 }).last().textContent()).includes('(1)'));
    console.log('PASS concurrent import deletions finishing out of order cannot resurrect a deleted row');
    await page.getByRole('button', { name: 'Xóa', exact: true }).click(); await waitDeletes(3);
    await releaseDelete(2, false);
    await page.getByText('Private A 3', { exact: true }).waitFor();
    assert.ok(dialogs.some(dialog => dialog.type === 'alert' && dialog.message.includes('Fixture request rejected')));
    await page.getByRole('button', { name: 'Xóa', exact: true }).click(); await waitDeletes(4);
    await releaseDelete(3);
    await page.getByText('Bạn chưa import file game nào.', { exact: true }).waitFor();
    console.log('PASS failed deletion keeps the game; retry deletes it and updates the empty state');

    const fileInput = page.locator('#jar-file-input'), nameInput = page.getByPlaceholder('vd: Ninja School 2, Tam Quốc Chí, v.v.');
    await fileInput.setInputFiles({ name: 'fixture.jar', mimeType: 'application/java-archive', buffer: Buffer.from('PK-fixture') });
    await nameInput.fill('Uploaded A'); failImport = true;
    await page.getByRole('button', { name: 'BẮT ĐẦU IMPORT', exact: true }).click();
    await page.getByText('Fixture request rejected', { exact: true }).waitFor();
    assert.equal(await page.getByText('Đã import thành công', { exact: false }).count(), 0);
    failImport = false;
    await page.getByRole('button', { name: 'BẮT ĐẦU IMPORT', exact: true }).click();
    await page.getByText('Uploaded A', { exact: true }).waitFor();
    assert.equal(await nameInput.inputValue(), '');
    console.log('PASS rejected import reports failure; successful retry adds the game and resets the form');

    await fileInput.setInputFiles({ name: 'private-a.jar', mimeType: 'application/java-archive', buffer: Buffer.from('PK-fixture') });
    await nameInput.fill('Draft name from A');
    holdAccounts.add('a'); holdAccounts.add('b');
    await page.evaluate(() => window.dispatchEvent(new Event('gtt:auth-changed'))); await waitReads('a');
    await switchAccount('b'); await waitReads('b');
    await page.getByText('Uploaded A', { exact: true }).waitFor({ state: 'detached' });
    assert.equal(await nameInput.inputValue(), '');
    assert.equal(await fileInput.evaluate(input => input.files.length), 0);
    assert.equal(await page.getByText('Uploaded A', { exact: true }).count(), 0);
    await releaseReads('a');
    assert.equal(await page.getByText('Uploaded A', { exact: true }).count(), 0);
    await releaseReads('b');
    await page.getByText('Private B 1', { exact: true }).waitFor();
    await page.locator('button[title="Account B"]').waitFor();
    await page.evaluate(() => { localStorage.setItem('gametuoitho_token', 'account-a'); window.dispatchEvent(new Event('gtt:auth-changed')); });
    await page.getByText('Uploaded A', { exact: true }).waitFor();
    await page.locator('button[title="Account A"]').waitFor();
    assert.equal(await page.getByText('Private B 1', { exact: true }).count(), 0);
    console.log('PASS import account changes clear the draft/file and old responses; same-tab auth events also refresh header/list');

    const beforeUnrelated = requests.length;
    await writer.evaluate(() => localStorage.setItem('unrelated-review-preference', '1'));
    await page.waitForTimeout(100);
    assert.equal(requests.length, beforeUnrelated, 'unrelated preferences must not reload personal state');
    await writer.evaluate(() => localStorage.clear());
    await page.waitForURL('**/login?**');
    assert.equal(await page.getByText('Uploaded A', { exact: true }).count(), 0);
    assert.equal(await page.locator('button[title="Account A"]').count(), 0);
    await switchAccount('a');
    await page.locator('button[title="Account A"]').waitFor();
    await page.goto(origin + '/me/library/');
    await page.getByText('Uploaded A', { exact: true }).waitFor();
    await page.locator('button[title="Account A"]').waitFor();
    await writer.close(); // Isolate the current-token 401 from the other tab's logout handling.
    await page.evaluate(() => { localStorage.setItem('gametuoitho_token', 'account-expired'); window.dispatchEvent(new Event('gtt:auth-changed')); });
    await page.waitForURL('**/login?**');
    assert.equal(new URL(page.url()).searchParams.get('reason'), 'expired', 'auth refresh must preserve the expired-session reason');
    assert.equal(await page.evaluate(() => localStorage.getItem('gametuoitho_token')), null);
    assert.deepEqual(errors, []);
    console.log('PASS unrelated storage writes do nothing; storage.clear logs out; expired sessions retain the login reason without browser errors');
  } finally { await context.close(); }
}

async function main() {
  assert.ok(fs.existsSync(path.join(dist, 'admin/games/index.html')), 'Run pnpm cf:build first');
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let filename = path.resolve(dist, '.' + pathname);
    if (fs.existsSync(filename) && fs.statSync(filename).isDirectory()) filename = path.join(filename, 'index.html');
    if (!filename.startsWith(dist + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
      res.writeHead(404); res.end(); return;
    }
    res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(filename)] || 'application/octet-stream');
    fs.createReadStream(filename).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const engine = process.env.REVIEW_BROWSER === 'webkit' ? webkit : chromium;
    const executablePath = engine === webkit ? process.env.WEBKIT_EXECUTABLE_PATH : process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    browser = await engine.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await context.addInitScript(() => localStorage.setItem('gametuoitho_token', 'local-admin-review-only'));
    const pending = [], errors = [], catalogRequests = [];
    let failLibrary = true, failImports = true, failCatalog = false;
    const json = (route, data, metadata = {}) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data, ...metadata }) });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/api/v1/admin/games') { pending.push(route); return; }
      if (url.pathname === '/api/v1/auth/me') return json(route, { id: 'fixture-admin', role: 'ADMIN', username: 'Fixture' });
      const unavailable = () => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: { message: 'Fixture API unavailable' } }) });
      if (url.pathname === '/api/v1/me/library') return failLibrary ? unavailable() : json(route, [{ id: 'library-fixture', source_type: 'CATALOG', custom_name: 'Recovered library game', catalog_game_slug: 'featured', created_at: '2026-11-11T00:00:00Z' }]);
      if (url.pathname === '/api/v1/me/imports') return failImports ? unavailable() : json(route, []);
      if (url.pathname === '/api/v1/games') {
        catalogRequests.push(url);
        return failCatalog ? unavailable() : json(route, [featured], { pagination: { page: 1, limit: 16, total: 1, totalPages: 1 } });
      }
      if (url.pathname.startsWith('/api/')) return json(route, []);
      return route.continue();
    });
    const page = await context.newPage();
    page.on('dialog', dialog => dialog.accept());
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(5000);
    const waitRequests = async count => {
      for (let i = 0; pending.length < count && i < 500; i++) await page.waitForTimeout(10);
      assert.equal(pending.length, count, `Expected ${count} game requests`);
    };
    const rows = () => page.locator('#games-table-body input[type="checkbox"]').evaluateAll(nodes => nodes.map(node => node.dataset.id));
    const respond = async (index, data, metadata = {}) => {
      const response = page.waitForResponse(res => res.url() === pending[index].request().url());
      await json(pending[index], data, metadata); await response;
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    await page.goto(origin + '/admin/games/');
    await waitRequests(1);
    await page.locator('#featured-filter').click();
    await waitRequests(2);
    assert.equal(new URL(pending[1].request().url()).searchParams.get('featured'), 'true');
    await respond(1, [featured]);
    assert.deepEqual(await rows(), ['featured']);
    await respond(0, [featured, other]);
    assert.deepEqual(await rows(), ['featured'], 'late unfiltered response must not replace the active featured filter');
    console.log('PASS delayed initial response cannot overwrite featured games');

    await page.locator('#featured-filter').click(); await waitRequests(3);
    await page.locator('#featured-filter').click(); await waitRequests(4);
    await respond(3, []);
    assert.deepEqual(await rows(), []);
    await respond(2, [featured, other]);
    assert.deepEqual(await rows(), [], 'late response must not overwrite the latest empty result');
    assert.equal(await page.locator('#featured-filter').getAttribute('aria-pressed'), 'true');
    assert.ok((await page.locator('#games-table-body').textContent()).includes('Game ưa thích'));
    assert.deepEqual(errors, []);
    console.log('PASS rapid filter toggles preserve the latest empty result and selection');

    const firstPage = Array.from({ length: 100 }, (_, i) => ({ ...other, id: `page-1-${i}`, slug: `page-1-${i}` }));
    const secondPage = Array.from({ length: 41 }, (_, i) => ({ ...other, id: `page-2-${i}`, slug: `page-2-${i}` }));
    await page.locator('#featured-filter').click(); await waitRequests(5);
    await respond(4, firstPage, { total: 141 });
    assert.equal(await page.locator('#count-all').textContent(), '141');
    assert.equal(await page.locator('.game-checkbox').count(), 100);
    assert.equal(await page.locator('#games-prev-page').isDisabled(), true);
    await page.locator('#select-all-header').check();
    await page.locator('#games-next-page').click(); await waitRequests(6);
    assert.equal(new URL(pending[5].request().url()).searchParams.get('page'), '2');
    await respond(5, secondPage, { total: 141 });
    assert.equal(await page.locator('.game-checkbox').count(), 41);
    assert.equal(await page.locator('#count-all').textContent(), '141');
    assert.equal(await page.locator('#games-page-info').textContent(), 'Trang 2 / 2 · 141 game');
    assert.equal(await page.locator('#games-next-page').isDisabled(), true);
    assert.equal(await page.locator('#select-all-header').isChecked(), false);
    assert.equal(await page.locator('#selected-count').textContent(), '0');
    assert.equal(new URL(page.url()).searchParams.get('page'), '2');
    console.log('PASS admin uses API total, paginates 141 games and clears selection between pages');

    await page.locator('[data-status="DRAFT"]').click(); await waitRequests(7);
    assert.equal(new URL(pending[6].request().url()).searchParams.get('page'), '1');
    assert.equal(new URL(pending[6].request().url()).searchParams.get('status'), 'DRAFT');
    await respond(6, firstPage.map(game => ({ ...game, status: 'DRAFT' })), { total: 101 });
    await page.locator('#games-next-page').click(); await waitRequests(8);
    await respond(7, [{ ...other, id: 'last-draft', status: 'DRAFT' }], { total: 101 });
    await page.locator('.delete-btn[data-id="last-draft"]').click(); await waitRequests(9);
    await respond(8, [], { total: 100 }); await waitRequests(10);
    assert.equal(new URL(pending[9].request().url()).searchParams.get('page'), '1');
    assert.equal(new URL(pending[9].request().url()).searchParams.get('status'), 'DRAFT');
    await respond(9, firstPage.map(game => ({ ...game, status: 'DRAFT' })), { total: 100 });
    assert.equal(await page.locator('#games-pagination').isVisible(), false);
    assert.equal(await page.locator('.game-checkbox').count(), 100);
    console.log('PASS filter changes reset page; deleting the last row on page 2 returns to page 1');

    await page.goto(origin + '/admin/games/?status=DRAFT&featured=true&search=fixture&page=2');
    await waitRequests(11);
    await respond(10, [{ ...featured, status: 'DRAFT' }], { total: 101 });
    await page.locator('#games-prev-page').click(); await waitRequests(12);
    await pending[11].fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: { message: 'Fixture API unavailable' } }) });
    await page.getByRole('button', { name: 'Thử lại', exact: true }).waitFor();
    assert.ok((await page.getByRole('alert').textContent()).includes('Fixture API unavailable'));
    assert.deepEqual(await rows(), []);
    await page.getByRole('button', { name: 'Thử lại', exact: true }).click(); await waitRequests(13);
    const retryQuery = new URL(pending[12].request().url()).searchParams;
    for (const [key, value] of Object.entries({ page: '1', status: 'DRAFT', featured: 'true', search: 'fixture' })) assert.equal(retryQuery.get(key), value);
    await respond(12, [{ ...featured, status: 'DRAFT' }], { total: 1 });
    assert.deepEqual(await rows(), ['featured']);
    assert.equal(await page.getByRole('alert').count(), 0);
    console.log('PASS API failure is distinct from empty results; retry retains all filters');

    await page.goto(origin + '/me/library/');
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByText('Thư viện của bạn đang trống', { exact: true }).count(), 0);
    failLibrary = false;
    await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
    await page.getByText('Recovered library game', { exact: true }).waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);

    await page.goto(origin + '/me/imports/');
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByText('Bạn chưa import file game nào.', { exact: true }).count(), 0);
    failImports = false;
    await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
    await page.getByText('Bạn chưa import file game nào.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);

    await page.goto(origin + '/games/');
    await page.getByText(featured.name, { exact: true }).waitFor();
    failCatalog = true;
    await page.getByPlaceholder('Tìm theo tên game, nhà phát hành...').fill('retry-query');
    await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('.game-card').count(), 0, 'failed searches must not keep old cards');
    assert.equal(await page.getByText('Không tìm thấy game phù hợp', { exact: true }).count(), 0);
    failCatalog = false;
    await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
    await page.getByText(featured.name, { exact: true }).waitFor();
    assert.equal(catalogRequests.at(-1).searchParams.get('search'), 'retry-query');
    assert.equal(await page.getByRole('alert').count(), 0);
    console.log('PASS library, imports and catalog distinguish API failures from empty results and recover on retry');
    assert.deepEqual(errors, []);
    await reviewPersonalState(browser, origin);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
