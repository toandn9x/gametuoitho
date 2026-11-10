// Run after the Web build: node tests/pm/admin-users-render-review.cjs
// Loads the actual built Astro page and React component against an isolated fixture API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const dist = path.resolve(__dirname, '../../apps/web/dist');
const cases = ['desktop', 'mobile', 'filters-pagination', 'empty', 'load-error', 'update-error'];
const injectedName = 'member <svg class="injected" onload="window.__injected=true">';
const fixtureUsers = [
  { id: 'member-a', username: injectedName, role: 'USER', status: 'ACTIVE' },
  { id: 'member-b', username: 'member_b', role: 'USER', status: 'BLOCKED' },
  { id: 'admin', username: 'administrator', role: 'ADMIN', status: 'ACTIVE' },
  ...Array.from({ length: 18 }, (_, index) => ({ id: `extra-${index}`, username: `extra_${index}`, role: 'USER', status: 'ACTIVE' })),
].map(user => ({ ...user, email: `${user.id}@fixture.invalid`, created_at: '2026-11-01 00:00:00', updated_at: '2026-11-01 00:00:00' }));

async function verify(id) {
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const waitFor = async (predicate) => {
    for (let index = 0; index < 200; index++) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Timed out waiting for UI state');
  };
  const rows = () => [...document.querySelectorAll('tbody tr')];
  const memberRow = () => rows().find(row => row.textContent.includes('member-a@fixture.invalid'));
  const button = (text) => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text);
  const loaded = () => document.querySelector('table')?.getAttribute('aria-busy') === 'false';
  try {
    await waitFor(() => loaded() && !document.documentElement.hasAttribute('data-admin-pending'));
    check(document.title === 'Quản Lý Người Dùng', 'Wrong account management title');
    const nav = document.querySelector('nav');
    check(nav.querySelector('[href="/admin/users"]')?.textContent.includes('Quản Lý Người Dùng'), 'Missing account menu');
    check(nav.querySelector('[href="/admin/user-imports"]')?.textContent.includes('Game Người Dùng Tải Lên'), 'Missing separate game imports menu');

    if (id === 'empty') {
      check(document.querySelector('tbody').textContent.includes('Chưa có người dùng'), 'Missing empty state');
      check(!document.querySelector('[role="alert"]'), 'Empty state shown as an error');
    } else if (id === 'load-error') {
      check(document.querySelector('[role="alert"]')?.textContent.includes('FIXTURE_LOAD_FAILED'), 'Load error hidden');
      check(!document.querySelector('tbody').textContent.includes('Chưa có người dùng'), 'Failed load shown as empty result');
    } else {
      check(memberRow()?.textContent.includes('member <svg'), 'Account data not shown as literal text');
      check(!window.__injected && !document.querySelector('.injected'), 'Account data injected markup');
      const adminRow = rows().find(row => row.textContent.includes('administrator'));
      check(adminRow && !adminRow.querySelector('button'), 'Administrator has a status mutation button');
      memberRow().querySelector('summary').click();
      check(memberRow().querySelector('details').open && memberRow().textContent.includes('ID: member-a'), 'Account details unavailable');

      if (id === 'desktop' || id === 'update-error') {
        memberRow().querySelector('button').click();
        if (id === 'update-error') {
          await waitFor(() => document.querySelector('[role="alert"]')?.textContent.includes('FIXTURE_UPDATE_FAILED'));
          check(memberRow().textContent.includes('Đang hoạt động'), 'Failed update changed account status');
        } else {
          await waitFor(() => loaded() && memberRow()?.querySelector('button')?.textContent.trim() === 'Mở khóa');
          check(document.querySelector('[role="status"]')?.textContent.includes('Đã khóa'), 'Missing success feedback');
          memberRow().querySelector('button').click();
          await waitFor(() => loaded() && memberRow()?.querySelector('button')?.textContent.trim() === 'Khóa tài khoản');
          const dashboard = new DOMParser().parseFromString(await (await fetch('/built-dashboard')).text(), 'text/html');
          check(dashboard.querySelector('#stat-total-users')?.closest('a')?.getAttribute('href') === '/admin/users', 'Dashboard account card points to imports');
          check(dashboard.querySelector('#stat-total-imports')?.closest('a')?.getAttribute('href') === '/admin/user-imports', 'Dashboard import card points to accounts');
        }
      } else if (id === 'filters-pagination') {
        check(rows().length === 20, 'Initial page size is incorrect');
        button('Sau →').click();
        await waitFor(() => loaded() && rows().length === 1);
        check(button('Sau →').disabled, 'Last page still allows next');
        button('← Trước').click();
        await waitFor(() => loaded() && rows().length === 20);
        const selects = document.querySelectorAll('main select');
        selects[1].value = 'BLOCKED';
        selects[1].dispatchEvent(new Event('change', { bubbles: true }));
        await waitFor(() => loaded() && rows().length === 1);
        check(rows()[0].textContent.includes('member_b'), 'Status filter was not applied');
        selects[0].value = 'ADMIN';
        selects[0].dispatchEvent(new Event('change', { bubbles: true }));
        await waitFor(() => loaded() && document.querySelector('tbody').textContent.includes('Chưa có người dùng'));
      } else if (id === 'mobile') {
        check(window.innerWidth === 390, 'Mobile viewport not used');
        check(document.documentElement.scrollWidth <= window.innerWidth + 1, 'Page overflows horizontally on mobile');
        document.querySelector('#admin-menu-toggle').click();
        check(document.querySelector('#admin-menu-toggle').getAttribute('aria-expanded') === 'true', 'Mobile admin menu does not open');
      }
    }
    check(window.__errors.length === 0, `Browser errors: ${window.__errors.join('; ')}`);
  } catch (error) { failures.push(error.message); }
  parent.postMessage({ type: 'account-review', id, failures }, location.origin);
}

async function run() {
  const browser = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(candidate => fs.existsSync(candidate));
  assert(browser, 'An installed Chrome/Edge is required');
  const page = fs.readFileSync(path.join(dist, 'admin/users/index.html'), 'utf8');
  const states = new Map(cases.map(id => [id, structuredClone(fixtureUsers)]));
  const serverErrors = [];
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const send = (type, body, status = 200) => { response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); response.end(body); };
      const json = (body, status = 200) => send('application/json', JSON.stringify(body), status);
      if (url.pathname === '/') {
        send('text/html; charset=utf-8', `<!doctype html><pre id="result">RUNNING</pre><script>
          const cases=${JSON.stringify(cases)}; const results=[]; const frames=new Map();
          addEventListener('message', event=>{
            if(event.origin!==location.origin || event.data?.type!=='account-review' || frames.get(event.data.id)?.contentWindow!==event.source) return;
            results.push(event.data); if(results.length===cases.length) document.querySelector('#result').textContent=JSON.stringify(results);
          });
          for(const id of cases) { const frame=document.createElement('iframe'); frame.width=id==='mobile'?390:1280; frame.height=900; frame.src='/case/'+id; frames.set(id,frame); document.body.append(frame); }
        </script>`);
      } else if (url.pathname.startsWith('/case/')) {
        const id = url.pathname.slice(6); assert(cases.includes(id));
        const setup = `<script>window.__PUBLIC_API_URL__='/fixture/${id}/api/v1'; window.confirm=()=>true; window.__errors=[];
          addEventListener('error',event=>{if(event.message)window.__errors.push(event.message)});
          addEventListener('unhandledrejection',event=>window.__errors.push(String(event.reason)));</script>`;
        send('text/html; charset=utf-8', page.replace('<head>', `<head>${setup}`).replace('</body>', `<script>addEventListener('load',()=>(${verify.toString()})('${id}'));</script></body>`));
      } else if (url.pathname.startsWith('/fixture/')) {
        const [, , id, , , ...segments] = url.pathname.split('/');
        assert(cases.includes(id));
        const route = segments.join('/');
        if (route === 'auth/me') return json({ success: true, data: fixtureUsers[2] });
        if (request.method === 'PUT') {
          if (id === 'update-error') return json({ success: false, error: { code: 'BAD_REQUEST', message: 'FIXTURE_UPDATE_FAILED' } }, 400);
          let body = ''; for await (const chunk of request) body += chunk;
          const user = states.get(id).find(user => user.id === segments[2]); assert(user);
          user.status = JSON.parse(body).status;
          return json({ success: true, data: user });
        }
        if (id === 'load-error') return json({ success: false, error: { code: 'FAILED', message: 'FIXTURE_LOAD_FAILED' } }, 500);
        const filtered = (id === 'empty' ? [] : states.get(id)).filter(user =>
          (!url.searchParams.get('role') || user.role === url.searchParams.get('role')) &&
          (!url.searchParams.get('status') || user.status === url.searchParams.get('status')));
        const pageNumber = Number(url.searchParams.get('page') || 1);
        const limit = Number(url.searchParams.get('limit') || 20);
        json({ success: true, data: filtered.slice((pageNumber - 1) * limit, pageNumber * limit), pagination: { page: pageNumber, limit, total: filtered.length, totalPages: Math.ceil(filtered.length / limit) } });
      } else {
        const filename = url.pathname === '/built-dashboard' ? path.join(dist, 'admin/index.html') : path.resolve(dist, '.' + decodeURIComponent(url.pathname));
        const relative = path.relative(dist, filename);
        assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
        if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) return send('text/plain', 'Not found', 404);
        const type = filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : filename.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8';
        send(type, fs.readFileSync(filename));
      }
    } catch (error) { serverErrors.push(error.message); response.writeHead(500); response.end('Fixture server error'); }
  });
  const tempRoot = fs.realpathSync(os.tmpdir());
  const profile = fs.mkdtempSync(path.join(tempRoot, 'gametuoitho-account-review-'));
  let child;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const url = `http://127.0.0.1:${server.address().port}/`;
    const output = await new Promise((resolve, reject) => {
      child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--no-proxy-server', `--user-data-dir=${profile}`, '--virtual-time-budget=15000', '--dump-dom', url], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = '';
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Headless browser timed out')); }, 45000);
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-1500); });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('close', code => { clearTimeout(timeout); code === 0 ? resolve(stdout) : reject(new Error(`Browser exit ${code}: ${stderr}`)); });
    });
    assert.deepEqual(serverErrors, []);
    const match = output.match(/<pre id="result">([\s\S]*?)<\/pre>/);
    assert(match && match[1] !== 'RUNNING', 'Browser did not finish account UI checks');
    const results = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    assert.equal(results.length, cases.length);
    for (const result of results) console.log(`${result.failures.length ? 'FAIL' : 'PASS'} ${result.id}${result.failures.length ? ': ' + result.failures.join('; ') : ''}`);
    assert(results.every(result => result.failures.length === 0), 'Account UI regression checks failed');
    console.log(`Account UI: ${cases.length}/${cases.length} cases passed (actual built UI, fixture API).`);
  } finally {
    if (child && child.exitCode === null) child.kill();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(profile)), tempRoot);
    assert(path.basename(profile).startsWith('gametuoitho-account-review-'));
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
