// Built admin page against local API fixtures; no real account, database or cloud writes.
// Run after pnpm cf:build; PLAYWRIGHT_MODULE_PATH may point to an existing installation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const dist = path.resolve(__dirname, '../../apps/web/dist');
const featured = { id: 'featured', name: 'Featured fixture', slug: 'featured', is_featured: true, status: 'PUBLISHED', visibility: 'PUBLIC' };
const other = { ...featured, id: 'other', slug: 'other', name: 'Other fixture', is_featured: false };

async function main() {
  assert.ok(fs.existsSync(path.join(dist, 'admin/games/index.html')), 'Run pnpm cf:build first');
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const filename = path.resolve(dist, '.' + (pathname === '/admin/games/' ? '/admin/games/index.html' : pathname));
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
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await context.addInitScript(() => localStorage.setItem('gametuoitho_token', 'local-admin-review-only'));
    const pending = [], errors = [];
    const json = (route, data) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/api/v1/admin/games') { pending.push(route); return; }
      if (url.pathname === '/api/v1/auth/me') return json(route, { id: 'fixture-admin', role: 'ADMIN', username: 'Fixture' });
      if (url.pathname.startsWith('/api/')) return json(route, []);
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(5000);
    const waitRequests = async count => {
      for (let i = 0; pending.length < count && i < 500; i++) await page.waitForTimeout(10);
      assert.equal(pending.length, count, `Expected ${count} game requests`);
    };
    const rows = () => page.locator('#games-table-body input[type="checkbox"]').evaluateAll(nodes => nodes.map(node => node.dataset.id));
    const respond = async (index, data) => {
      const response = page.waitForResponse(res => res.url() === pending[index].request().url());
      await json(pending[index], data); await response;
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
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
