// Actual built UI + API + SQLite E2E. No real user DB/uploads, external requests,
// JAR execution, crawler downloads, or additional npm dependencies.
// Build web first, then: node tests/pm/home-featured-review.cjs [--keep]
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const apiRequire = createRequire(path.join(root, 'apps/api/package.json'));
const Database = apiRequire('better-sqlite3');
const keep = process.argv.includes('--keep');
assert.ok(process.argv.slice(2).every(arg => arg === '--keep'), 'Usage: node tests/pm/home-featured-review.cjs [--keep]');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const redact = value => String(value).replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]').replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]');

class CDP {
  constructor(url, onEvent) {
    this.socket = new WebSocket(url); this.pending = new Map(); this.id = 0;
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP connection timeout')), 5000);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const request = this.pending.get(message.id); if (!request) return;
        clearTimeout(request.timer); this.pending.delete(message.id);
        message.error ? request.reject(new Error(`${request.method}: ${message.error.message}`)) : request.resolve(message.result);
      } else Promise.resolve(onEvent(message)).catch(error => { this.eventError = error; });
    });
    this.socket.addEventListener('close', () => {
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Own Chrome connection closed')); }
      this.pending.clear();
    });
  }
  async send(method, params = {}) {
    await this.ready;
    if (this.eventError) throw this.eventError;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 5000);
      this.pending.set(id, { method, resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
}

async function main() {
  assert.ok(fs.existsSync(path.join(root, 'apps/web/dist/index.html')), 'Build the web app before this E2E check');
  const tempRoot = fs.realpathSync(os.tmpdir());
  const runDir = fs.mkdtempSync(path.join(tempRoot, 'gametuoitho-home-review-'));
  const dbPath = path.join(runDir, 'isolated.sqlite');
  const profile = path.join(runDir, 'chrome-profile');
  const checks = [], requests = [], dialogs = [], browserErrors = [];
  let server, browser, cdp, sqlite, serverLog = '', browserLog = '', base, failure;
  let failMutation = false, heldMutation = null, interceptedMutations = 0;
  const print = value => console.log(`[home-featured-review] ${redact(value)}`);
  function check(name, condition, detail = '') {
    checks.push({ name, pass: !!condition, detail: redact(detail) });
    print(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${redact(detail)}` : ''}`);
    assert.ok(condition, name);
  }
  async function waitFor(probe, label, timeout = 10000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (server?.exitCode !== null && server?.exitCode !== undefined) throw new Error(`Own server exited: ${server.exitCode}`);
      if (cdp?.eventError) throw cdp.eventError;
      try { const result = await probe(); if (result) return result; }
      catch (error) { if (!/context.*destroyed|Cannot find context|Execution context/i.test(error.message)) throw error; }
      await sleep(100);
    }
    throw new Error(`Timeout waiting for ${label}`);
  }
  async function api(method, route, { token, body } = {}) {
    const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000) });
    return { status: response.status, json: await response.json() };
  }
  async function navigate(route) {
    await cdp.send('Page.navigate', { url: base + route });
    await waitFor(() => cdp.evaluate(`document.readyState === 'complete' && location.pathname === ${JSON.stringify(new URL(route, base).pathname)}`), `navigation to ${route}`);
  }
  async function screenshot(name) {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(runDir, name + '.png'), Buffer.from(shot.data, 'base64'));
  }
  const fixtures = [
    { id: crypto.randomUUID(), name: 'PM Ninja Alpha', slug: 'pm-ninja-alpha', date: '2020-01-01T00:00:00Z' },
    { id: crypto.randomUUID(), name: 'PM Puzzle Beta', slug: 'pm-puzzle-beta', date: '2024-01-01T00:00:00Z' },
    { id: crypto.randomUUID(), name: 'PM Newest Gamma', slug: 'pm-newest-gamma', date: '2026-01-01T00:00:00Z' },
  ];
  const selected = fixtures[0], unselected = fixtures[1];
  const starSelector = game => `.featured-game-btn[data-id="${game.id}"]`;
  const starState = game => cdp.evaluate(`(() => { const b=document.querySelector(${JSON.stringify(starSelector(game))}); return b ? {pressed:b.getAttribute('aria-pressed'),busy:b.getAttribute('aria-busy'),disabled:b.disabled,text:b.textContent} : null; })()`);
  const cards = selector => cdp.evaluate(`(() => { const region=document.querySelector(${JSON.stringify(selector)}); return region ? [...new Set([...region.querySelectorAll('a[href^="/game/"]')].map(a=>a.getAttribute('href')))].sort() : null; })()`);
  const featuredRegion = 'section[aria-labelledby="favorite-games-heading"]';
  const hardStop = setTimeout(() => { failure ||= new Error('E2E overall limit reached (180 seconds)'); browser?.kill(); server?.kill(); cdp?.socket.close(); }, 180000);
  try {
    print('Starting isolated loopback server and hidden Chrome; all external browser requests are blocked.');
    server = spawn(process.execPath, ['--import', pathToFileURL(apiRequire.resolve('tsx')).href, path.join(root, 'apps/api/src/server.ts')], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HOST: '127.0.0.1', PORT: '0', NODE_ENV: 'test', ENVIRONMENT: 'development', DB_PATH: dbPath, UPLOADS_DIR: path.join(runDir, 'uploads'), WEB_DIST: path.join(root, 'apps/web/dist'), JWT_SECRET: crypto.randomBytes(48).toString('hex'), ADMIN_BOOTSTRAP_USERNAME: '', ADMIN_BOOTSTRAP_PASSWORD: '', ADMIN_BOOTSTRAP_EMAIL: '' },
    });
    server.on('error', error => { failure = error; });
    const addServerLog = chunk => { serverLog = (serverLog + redact(chunk)).slice(-16000); };
    server.stdout.on('data', addServerLog); server.stderr.on('data', addServerLog);
    await waitFor(() => { if (failure) throw failure; const match=serverLog.match(/Web & API Server:\s+http:\/\/localhost:(\d+)/); if (match) { base=`http://127.0.0.1:${match[1]}`; return true; } return false; }, 'own random server port', 20000);
    check('isolated app is healthy', (await api('GET', '/health')).status === 200);
    const credentials = { username: 'pm_feature_admin', email: 'pm-feature@example.invalid', password: crypto.randomBytes(18).toString('hex') + 'Aa1!' };
    const registration = await api('POST', '/api/v1/auth/register', { body: credentials });
    check('fresh fixture account is registered', registration.status === 201);
    sqlite = new Database(dbPath);
    sqlite.pragma('foreign_keys = ON');
    const adminId = sqlite.prepare('SELECT id FROM users WHERE username = ?').get(credentials.username)?.id;
    assert.ok(adminId); sqlite.prepare("UPDATE users SET role='ADMIN' WHERE id=?").run(adminId);
    // This database was created by this test. Fixture state never touches workspace DB/uploads.
    sqlite.prepare('DELETE FROM games').run();
    const categoryId = sqlite.prepare("SELECT id FROM categories WHERE status='ACTIVE' LIMIT 1").get()?.id;
    assert.ok(categoryId, 'isolated schema must have a category');
    const insert = sqlite.prepare("INSERT INTO games(id,name,slug,description,category_id,status,visibility,source_type,created_by,published_at,created_at,updated_at,is_featured) VALUES(?,?,?,?,?,'PUBLISHED','PUBLIC','ADMIN',?,?,?,?,0)");
    for (const game of fixtures) insert.run(game.id, game.name, game.slug, `Fixture ${game.name}`, categoryId, adminId, game.date, game.date, game.date);
    const login = await api('POST', '/api/v1/auth/login', { body: { usernameOrEmail: credentials.username, password: credentials.password } });
    const token = login.json?.data?.token;
    check('isolated admin logs in', login.status === 200 && !!token);
    const initial = await api('GET', '/api/v1/games?featured=true');
    check('anonymous featured list starts empty', initial.status === 200 && initial.json.success && initial.json.data.length === 0);
    const chrome = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(candidate => candidate && fs.existsSync(candidate));
    assert.ok(chrome, 'Installed Chrome/Chromium required; optionally set CHROME_PATH');
    fs.mkdirSync(profile);
    browser = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--window-size=1440,1080', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    browser.on('error', error => { failure = error; });
    browser.stderr.on('data', chunk => { browserLog = (browserLog + redact(chunk)).slice(-4000); });
    const portFile = path.join(profile, 'DevToolsActivePort');
    await waitFor(() => { if (failure) throw failure; return fs.existsSync(portFile); }, 'own Chrome debugging port');
    const port = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find(item => item.type === 'page'); assert.ok(target);
    cdp = new CDP(target.webSocketDebuggerUrl, async ({ method, params = {} }) => {
      if (method === 'Page.javascriptDialogOpening') { dialogs.push(params.message); await cdp.send('Page.handleJavaScriptDialog', { accept: true }); }
      if (method === 'Runtime.exceptionThrown') browserErrors.push(redact(params.exceptionDetails.exception?.description || params.exceptionDetails.text));
      if (method === 'Network.responseReceived' && params.response.url.startsWith(base + '/api/')) requests.push({ url: params.response.url, status: params.response.status });
      if (method === 'Fetch.requestPaused') {
        const url = new URL(params.request.url);
        if (url.origin !== base) return cdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' });
        if (failMutation && params.request.method === 'PUT' && url.pathname === `/api/v1/admin/games/${unselected.id}`) {
          interceptedMutations++; heldMutation = params.requestId; return;
        }
        await cdp.send('Fetch.continueRequest', { requestId: params.requestId });
      }
    });
    await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('Network.enable')]);
    await cdp.send('Network.setBypassServiceWorker', { bypass: true });
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    // Only this test's origin receives a synthetic test-session token. Never persist token in artifacts.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.origin===${JSON.stringify(base)})localStorage.setItem('gametuoitho_token',${JSON.stringify(token)});` });
    await navigate('/');
    await waitFor(() => cdp.evaluate(`document.querySelector(${JSON.stringify(featuredRegion)})?.textContent.includes('Chưa có game ưa thích nào được chọn.')`), 'truthful initial homepage empty state');
    check('homepage does not substitute newest games when no stars are selected', (await cards(featuredRegion)).length === 0);
    const formInfo = await cdp.evaluate(`(() => { const input=document.querySelector('#home-game-search'), form=input?.closest('form'), button=form?.querySelector('button[type="submit"]'); return {exists:!!input,role:form?.getAttribute('role'),name:input?.name,label:button?.innerText.trim(),visible:!!button?.getClientRects().length}; })()`);
    check('homepage has accessible search and visible Tìm game submit', formInfo.exists && formInfo.role === 'search' && formInfo.name === 'search' && formInfo.label === 'Tìm game' && formInfo.visible);
    await navigate('/admin/games');
    await waitFor(() => starState(selected), 'actual admin star button');
    check('admin star starts unselected', (await starState(selected)).pressed === 'false');
    await cdp.evaluate(`document.querySelector(${JSON.stringify(starSelector(selected))}).click()`);
    await waitFor(async () => (await starState(selected))?.pressed === 'true', 'admin star confirmation');
    const featured = await api('GET', '/api/v1/games?featured=true');
    check('real admin star updates anonymous featured API', featured.json.success && featured.json.data.length === 1 && featured.json.data[0].id === selected.id && featured.json.data[0].is_featured === true);
    await navigate('/admin/games'); await waitFor(async () => (await starState(selected))?.pressed === 'true', 'star persisted after page reload');
    check('star selection persists after reload', (await starState(selected)).pressed === 'true');
    await screenshot('1-admin-featured');
    failMutation = true;
    await cdp.evaluate(`(() => { const b=document.querySelector(${JSON.stringify(starSelector(unselected))}); b.click(); b.dispatchEvent(new MouseEvent('click',{bubbles:true})); })()`);
    await waitFor(() => heldMutation, 'held fixture PUT request');
    const pending = await starState(unselected);
    check('pending star is disabled/busy and duplicate clicks do not create more PUTs', pending.disabled && pending.busy === 'true' && interceptedMutations === 1);
    const held = heldMutation; heldMutation = null;
    await cdp.send('Fetch.fulfillRequest', { requestId: held, responseCode: 503, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify({ success: false, error: { message: 'PM fixture update failure' } })).toString('base64') });
    await waitFor(async () => { const state=await starState(unselected); return state && !state.disabled && state.busy === null; }, 'star button restored after API error');
    failMutation = false;
    check('failed star update preserves previous state and explains failure', (await starState(unselected)).pressed === 'false' && dialogs.includes('PM fixture update failure'));
    const afterFailure = await api('GET', '/api/v1/games?featured=true');
    check('failed update leaves stored featured selection unchanged', afterFailure.json.data.length === 1 && afterFailure.json.data[0].id === selected.id);
    await navigate('/');
    await waitFor(async () => (await cards(featuredRegion))?.length === 1, 'homepage selected cards');
    check('homepage favorite section contains only the starred game', JSON.stringify(await cards(featuredRegion)) === JSON.stringify([`/game/${selected.slug}`]));
    await screenshot('2-home-featured');
    await cdp.evaluate(`document.querySelector(${JSON.stringify(featuredRegion)}).querySelector('a[href="/games?featured=true"]').click()`);
    await waitFor(() => cdp.evaluate(`location.pathname==='/games' && new URLSearchParams(location.search).get('featured')==='true'`), 'featured catalog navigation');
    await waitFor(async () => { const result=await cards('main'); return result?.length === 1 && result[0] === `/game/${selected.slug}`; }, 'featured catalog result');
    check('Xem tất cả keeps featured filter and only selected catalog cards', JSON.stringify(await cards('main')) === JSON.stringify([`/game/${selected.slug}`]));
    check('catalog asks the real API for featured games', requests.some(item => new URL(item.url).searchParams.get('featured') === 'true'));
    await navigate('/');
    await waitFor(() => cdp.evaluate(`!!document.querySelector('#home-game-search')`), 'homepage search');
    await cdp.evaluate(`(() => { const input=document.querySelector('#home-game-search'); input.value='Puzzle'; input.closest('form').querySelector('button[type="submit"]').click(); })()`);
    await waitFor(() => cdp.evaluate(`location.pathname==='/games' && new URLSearchParams(location.search).get('search')==='Puzzle'`), 'submitted search URL');
    await waitFor(async () => { const result=await cards('main'); return result?.length === 1 && result[0] === `/game/${unselected.slug}`; }, 'API-filtered search results');
    check('homepage search submits query and displays only matching real catalog results', JSON.stringify(await cards('main')) === JSON.stringify([`/game/${unselected.slug}`]));
    check('catalog sent search query to the API', requests.some(item => new URL(item.url).searchParams.get('search') === 'Puzzle'));
    await screenshot('3-home-search-results');
    await navigate('/admin/games'); await waitFor(() => starState(selected), 'admin star for removal');
    await cdp.evaluate(`document.querySelector(${JSON.stringify(starSelector(selected))}).click()`);
    await waitFor(async () => (await starState(selected))?.pressed === 'false', 'star removed');
    const finalList = await api('GET', '/api/v1/games?featured=true');
    check('unstar removes the game from anonymous featured API', finalList.json.success && finalList.json.data.length === 0);
    await navigate('/');
    await waitFor(() => cdp.evaluate(`document.querySelector(${JSON.stringify(featuredRegion)})?.textContent.includes('Chưa có game ưa thích nào được chọn.')`), 'empty homepage after unstar');
    check('homepage shows truthful empty state after the last unstar', (await cards(featuredRegion)).length === 0);
    check('no uncaught browser exceptions', browserErrors.length === 0, browserErrors.join('; '));
    print(`${checks.length}/${checks.length} checks passed.`);
  } catch (error) {
    failure = error; print(`FAILED: ${error.message}`);
    if (cdp) await screenshot('failure').catch(() => {});
  } finally {
    clearTimeout(hardStop);
    if (cdp) { await cdp.send('Browser.close').catch(() => {}); cdp.socket.close(); }
    for (const processHandle of [browser, server]) {
      if (processHandle && processHandle.exitCode === null) {
        processHandle.kill();
        await Promise.race([new Promise(resolve => processHandle.once('close', resolve)), sleep(2000)]);
      }
    }
    sqlite?.close();
    fs.writeFileSync(path.join(runDir, 'review.json'), JSON.stringify({ checks, requests, dialogs, browserErrors, failure: failure ? redact(failure.message) : null, serverLog, browserLog }, null, 2));
    const resolved = path.resolve(runDir);
    assert.ok(path.dirname(resolved) === tempRoot && path.basename(resolved).startsWith('gametuoitho-home-review-'), 'Own temporary-directory cleanup containment check');
    if (keep || failure) print(`Artifacts: ${runDir}`);
    else fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
  if (failure) throw failure;
}
main().catch(error => { console.error(`[home-featured-review] ${redact(error.stack || error.message)}`); process.exitCode = 1; });
