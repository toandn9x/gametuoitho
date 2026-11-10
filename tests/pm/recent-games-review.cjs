// Actual built web + API + isolated SQLite. The emulator iframe is inert:
// no JVM/JAR execution, cloud writes, or production data are involved.
// Run after pnpm cf:build: node tests/pm/recent-games-review.cjs [--keep]
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
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const redact = value => String(value).replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[REDACTED_JWT]');

class CDP {
  constructor(url, onEvent) {
    this.socket = new WebSocket(url); this.pending = new Map(); this.id = 0;
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', () => reject(new Error('Own Chrome connection failed')), { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id); if (!pending) return;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
      } else Promise.resolve(onEvent(message)).catch(error => { this.error = error; });
    });
  }
  async send(method, params = {}) {
    await this.ready;
    if (this.error) throw this.error;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 5000);
      this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
}

async function main() {
  assert.ok(process.argv.slice(2).every(arg => arg === '--keep'), 'Usage: node tests/pm/recent-games-review.cjs [--keep]');
  assert.ok(fs.existsSync(path.join(root, 'apps/web/dist/index.html')), 'Build web first');
  const tempRoot = fs.realpathSync(os.tmpdir());
  const runDir = fs.mkdtempSync(path.join(tempRoot, 'gametuoitho-recent-review-'));
  const dbPath = path.join(runDir, 'fixture.sqlite'), profile = path.join(runDir, 'chrome-profile');
  let server, browser, cdp, sqlite, base, failure, serverLog = '', browserLog = '', failHistory = false;
  const checks = [], posts = [], errors = [];
  const print = message => console.log(`[recent-games-review] ${redact(message)}`);
  const check = (name, condition) => { checks.push({ name, pass: !!condition }); assert.ok(condition, name); print(`PASS ${name}`); };
  async function waitFor(probe, label, timeout = 12000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (failure) throw failure;
      if (cdp?.error) throw cdp.error;
      try { const result = await probe(); if (result) return result; }
      catch (error) { if (!/context.*destroyed|Cannot find context|Execution context/i.test(error.message)) throw error; }
      await sleep(80);
    }
    throw new Error(`Timeout: ${label}`);
  }
  async function api(method, route, token, body) {
    const result = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000) });
    const json = await result.json(); assert.ok(result.ok, `${method} ${route}: HTTP ${result.status}`); return json.data;
  }
  async function navigate(route) {
    await cdp.send('Page.navigate', { url: base + route });
    await waitFor(() => cdp.evaluate(`document.readyState==='complete' && location.pathname===${JSON.stringify(new URL(route, base).pathname)}`), route);
  }
  async function session(token, storageEvent = false) {
    await cdp.send('Network.setCookie', { name: 'token', value: token || '', url: base, path: '/', ...(token ? {} : { expires: 1 }) });
    await cdp.evaluate(`(() => { ${token ? `localStorage.setItem('gametuoitho_token',${JSON.stringify(token)});` : "localStorage.removeItem('gametuoitho_token');"} window.dispatchEvent(${storageEvent ? "new StorageEvent('storage',{key:'gametuoitho_token'})" : "new Event('gtt:auth-changed')"}); })()`);
  }
  const rows = () => cdp.evaluate("[...document.querySelectorAll('[data-recent-game]')].map(a=>({name:a.querySelector('h3').textContent,href:a.getAttribute('href'),text:a.textContent}))");
  const ready = count => waitFor(async () => (await rows()).length === count && !(await cdp.evaluate("!!document.querySelector('[data-recent-games] [aria-busy=\"true\"]')")), `${count} ready recent cards`);
  async function screenshot(name) {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(runDir, name + '.png'), Buffer.from(result.data, 'base64'));
  }
  const hardStop = setTimeout(() => { failure ||= new Error('Review exceeded 150 seconds'); browser?.kill(); server?.kill(); cdp?.socket.close(); }, 150000);
  try {
    server = spawn(process.execPath, ['--import', pathToFileURL(apiRequire.resolve('tsx')).href, path.join(root, 'apps/api/src/server.ts')], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HOST: '127.0.0.1', PORT: '0', NODE_ENV: 'test', ENVIRONMENT: 'development', DB_PATH: dbPath, UPLOADS_DIR: path.join(runDir, 'uploads'), WEB_DIST: path.join(root, 'apps/web/dist'), JWT_SECRET: crypto.randomBytes(48).toString('hex'), ADMIN_BOOTSTRAP_USERNAME: '', ADMIN_BOOTSTRAP_PASSWORD: '', ADMIN_BOOTSTRAP_EMAIL: '' },
    });
    server.on('error', error => { failure = error; });
    const log = value => { serverLog = (serverLog + redact(value)).slice(-8000); };
    server.stdout.on('data', log); server.stderr.on('data', log);
    await waitFor(() => { const match = serverLog.match(/Web & API Server:\s+http:\/\/localhost:(\d+)/); if (match) { base = `http://127.0.0.1:${match[1]}`; return true; } return false; }, 'isolated server', 20000);
    const account = async name => api('POST', '/api/v1/auth/register', null, { username: name, email: `${name}@fixture.invalid`, password: crypto.randomBytes(18).toString('hex') + 'Aa1!' });
    const a = await account('recent_a'), b = await account('recent_b');
    sqlite = new Database(dbPath); sqlite.pragma('foreign_keys = ON');
    const category = sqlite.prepare('SELECT id FROM categories LIMIT 1').get().id;
    const owner = sqlite.prepare("SELECT id FROM users WHERE username='recent_a'").get().id;
    for (let index = 0; index < 8; index++) {
      const key = `games/recent-${index}/game.jar`;
      sqlite.prepare("INSERT INTO game_assets(id,owner_user_id,asset_type,storage_key,original_filename,mime_type,sha256) VALUES(?,NULL,'JAR',?,'fixture.jar','application/java-archive',?)").run(`asset-${index}`, key, `fixture-${index}`);
      sqlite.prepare("INSERT INTO games(id,name,slug,category_id,status,visibility,source_type,created_by) VALUES(?,?,?,?,'PUBLISHED','PUBLIC','ADMIN',?)").run(`g${index}`, `Recent Game ${index}`, `recent-${index}`, category, owner);
      sqlite.prepare("INSERT INTO game_versions(id,game_id,version_name,jar_asset_id,jar_sha256,file_size,status) VALUES(?,?,'1.0',?,?,4,'ACTIVE')").run(`version-${index}`, `g${index}`, `asset-${index}`, `fixture-${index}`);
    }
    const privateKey = `users/${owner}/fixture.jar`;
    sqlite.prepare("INSERT INTO game_assets(id,owner_user_id,asset_type,storage_key,original_filename,mime_type,sha256,file_size) VALUES('private-asset',?,'JAR',?,'fixture.jar','application/java-archive','private-fixture',4)").run(owner, privateKey);
    sqlite.prepare("INSERT INTO user_library(id,user_id,custom_name,source_type,custom_asset_id) VALUES('private-import',?,'Game riêng của A','IMPORT','private-asset')").run(owner);
    const privatePath = path.join(runDir, 'uploads', privateKey); fs.mkdirSync(path.dirname(privatePath), { recursive: true }); fs.writeFileSync(privatePath, Buffer.from([80,75,3,4]));
    const chrome = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(value => value && fs.existsSync(value));
    assert.ok(chrome, 'Chrome required');
    browser = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--window-size=1440,1080', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    browser.on('error', error => { failure = error; }); browser.stderr.on('data', value => { browserLog = (browserLog + redact(value)).slice(-3000); });
    await waitFor(() => fs.existsSync(path.join(profile, 'DevToolsActivePort')), 'own Chrome');
    const port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0]);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    cdp = new CDP(targets.find(target => target.type === 'page').webSocketDebuggerUrl, async ({ method, params = {} }) => {
      if (method === 'Runtime.exceptionThrown') errors.push(redact(params.exceptionDetails.exception?.description || params.exceptionDetails.text));
      if (method === 'Fetch.requestPaused') {
        const url = new URL(params.request.url);
        if (url.origin !== base) return cdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' });
        if (url.pathname === '/emulator/run.html') return cdp.send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from('<!doctype html><title>Inert test frame</title>').toString('base64') });
        if (url.pathname === '/api/v1/me/history') {
          if (params.request.method === 'POST') posts.push(JSON.parse(params.request.postData));
          else if (failHistory) return cdp.send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 503, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify({ success: false, error: { message: 'Fixture temporary history failure' } })).toString('base64') });
        }
        await cdp.send('Fetch.continueRequest', { requestId: params.requestId });
      }
    });
    await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('Network.enable')]);
    await cdp.send('Network.setBypassServiceWorker', { bypass: true });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    await navigate('/'); await waitFor(() => cdp.evaluate("!!document.querySelector('astro-island[component-url*=RecentGames]:not([ssr])')"), 'guest hydration');
    check('guest homepage hides personal history', !(await cdp.evaluate("!!document.querySelector('[data-recent-games]')")));
    await session(a.token); await waitFor(() => cdp.evaluate("document.querySelector('[data-recent-games]')?.textContent.includes('Bạn chưa chơi game nào')"), 'account empty state');
    check('signed-in account has truthful empty state', (await rows()).length === 0);
    for (const [visit, index] of [0,1,0].entries()) {
      await navigate(`/play/recent-${index}`);
      const expected = visit + 1;
      await waitFor(() => posts.length >= expected, 'actual player history POST');
      await navigate('/'); await ready(index === 0 && expected === 1 ? 1 : 2);
    }
    check('catalog player records once per visit', posts.length === 3 && sqlite.prepare("SELECT play_count FROM user_game_activity WHERE user_id=? AND game_id='g0'").get(owner).play_count === 2);
    check('replaying promotes a game without duplicate cards', (await rows()).map(item => item.href).join(',') === '/play/recent-0,/play/recent-1');
    await navigate('/play/custom?importId=private-import');
    await waitFor(() => posts.some(post => post.user_library_id === 'private-import'), 'private player history');
    await navigate('/'); await ready(3);
    check('private import has a continue link and privacy label', (await rows()).some(item => item.href === '/play/custom?importId=private-import' && item.text.includes('riêng tư')));
    check('import player records once and sends only its library reference', posts.length === 4 && posts[3].user_library_id === 'private-import' && !posts[3].game_id);
    await session(b.token, true); await waitFor(() => cdp.evaluate("document.querySelector('[data-recent-games]')?.textContent.includes('Bạn chưa chơi game nào')"), 'cross-tab account switch');
    check('changing account clears previous account history', (await rows()).length === 0 && !(await cdp.evaluate("document.querySelector('[data-recent-games]').textContent.includes('Game riêng của A')")));
    await navigate('/play/recent-2'); await waitFor(() => posts.length === 5, 'second account play');
    await navigate('/'); await ready(1);
    check('second account sees only its own played game', (await rows())[0].href === '/play/recent-2');
    await session(null); await waitFor(() => cdp.evaluate("!document.querySelector('[data-recent-games]')"), 'logout history removal');
    check('logout immediately removes personal history', (await rows()).length === 0);
    await session(a.token); await ready(3);
    await api('POST', '/api/v1/me/history', a.token, { game_id: 'g3', activity_type: 'PLAY' });
    await cdp.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))"); await ready(4);
    check('returning to a cached homepage refreshes recent games', (await rows())[0].href === '/play/recent-3');
    failHistory = true; await cdp.evaluate("window.dispatchEvent(new Event('focus'))");
    await waitFor(() => cdp.evaluate("document.querySelector('[data-recent-games] [role=alert]')?.textContent.includes('Fixture temporary history failure')"), 'error with retry');
    check('history failure is visible with retry', await cdp.evaluate("!!document.querySelector('[data-recent-games] button')"));
    failHistory = false; await cdp.evaluate("document.querySelector('[data-recent-games] button').click()"); await ready(4);
    check('retry recovers real history', (await rows()).length === 4);
    for (const index of [2,4,5,6,7]) await api('POST', '/api/v1/me/history', a.token, { game_id: `g${index}`, activity_type: 'PLAY' });
    await cdp.evaluate("window.dispatchEvent(new Event('gtt:play-history-updated'))"); await ready(6);
    check('homepage shows at most six distinct games', (await rows()).length === 6);
    await cdp.evaluate("document.querySelector('[data-recent-games] a[href=\"/me/history\"]').click()");
    await waitFor(() => cdp.evaluate("location.pathname==='/me/history'"), 'full history navigation'); await ready(9);
    check('Xem tất cả opens full account history including imports', (await rows()).length === 9);
    for (const width of [1440,375]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
      await sleep(100);
      const sizes = await cdp.evaluate("({overflow:document.documentElement.scrollWidth>innerWidth,icons:[...document.querySelectorAll('[data-recent-game] .game-icon')].map(el=>Math.round(el.getBoundingClientRect().width))})");
      check(`compact icons and no horizontal overflow at ${width}px`, !sizes.overflow && sizes.icons.every(size => size === (width < 640 ? 56 : 64)));
      await screenshot(`recent-${width}`);
    }
    check('no uncaught browser exceptions', errors.length === 0);
    print(`${checks.length}/${checks.length} checks passed.`);
  } catch (error) {
    failure = error; print(`FAILED: ${error.message}`);
    if (cdp) await screenshot('failure').catch(() => {});
  } finally {
    clearTimeout(hardStop);
    if (cdp) { await cdp.send('Browser.close').catch(() => {}); cdp.socket.close(); }
    for (const child of [browser, server]) if (child && child.exitCode === null) { child.kill(); await Promise.race([new Promise(resolve => child.once('close', resolve)), sleep(1500)]); }
    sqlite?.close();
    fs.writeFileSync(path.join(runDir, 'results.json'), JSON.stringify({ checks, posts, errors, failure: failure ? redact(failure.message) : null, serverLog, browserLog }, null, 2));
    const resolved = path.resolve(runDir);
    assert.ok(path.dirname(resolved) === tempRoot && path.basename(resolved).startsWith('gametuoitho-recent-review-'), 'Own temporary-directory cleanup containment check');
    if (failure || process.argv.includes('--keep')) print(`Artifacts: ${resolved}`);
    else fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
  if (failure) throw failure;
}
main().catch(error => { console.error(redact(error.stack || error.message)); process.exitCode = 1; });
