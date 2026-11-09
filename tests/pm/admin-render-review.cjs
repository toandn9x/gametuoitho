// Independent DOM regression review. Runs current Astro client scripts, never a copied renderer.
// Usage: node tests/pm/admin-render-review.cjs [--browser <chrome-or-edge-path>]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const webSource = path.join(root, 'apps/web/src');
const ts = require(path.join(root, 'node_modules/typescript'));
const pages = {
  imports: 'pages/admin/user-imports.astro',
  storage: 'pages/admin/storage.astro',
};
const injection = '<svg class="pm-injected" onload="window.__pmExecuted += 1"></svg>';
const text = (field) => `${field} " & < > ${injection}`;
const importItem = {
  id: 'import-" data-pm-injected="id',
  custom_name: text('custom_name'),
  custom_original_filename: text('filename'),
  owner_username: text('username'),
  owner_email: text('email'),
  custom_sha256: 'hash-" data-pm-injected="hash',
  custom_file_size: 1024,
  created_at: '2026-01-01T00:00:00.000Z',
};
const assetItem = {
  id: 'asset-1',
  asset_type: text('asset_type'),
  storage_key: text('storage_key'),
  original_filename: text('original_filename'),
  file_size: 1024,
  status: text('status'),
  url: '/safe-asset?one=1&two=2',
};
const cases = [
  { id: 'imports-markup', page: 'imports', data: [importItem], kind: 'imports-markup' },
  { id: 'storage-markup', page: 'storage', data: [assetItem], kind: 'storage-markup' },
  {
    id: 'storage-unsafe-links', page: 'storage', kind: 'links',
    data: [
      { ...assetItem, asset_type: 'JAR', status: 'ACTIVE', storage_key: 'unsafe-js', original_filename: 'javascript.jar', url: 'javascript:window.__pmExecuted+=1' },
      { ...assetItem, asset_type: 'JAR', status: 'ACTIVE', storage_key: 'unsafe-data', original_filename: 'data.jar', url: 'data:text/html,<script>opener.__pmExecuted+=1</script>' },
      { ...assetItem, asset_type: 'JAR', status: 'ACTIVE', storage_key: 'safe-url', original_filename: 'safe.jar' },
    ],
  },
  { id: 'imports-empty', page: 'imports', data: [], kind: 'empty' },
  { id: 'storage-empty', page: 'storage', data: [], kind: 'empty' },
  { id: 'imports-load-error', page: 'imports', data: [], kind: 'error' },
  { id: 'storage-load-error', page: 'storage', data: [], kind: 'error' },
  {
    id: 'imports-delete-error', page: 'imports', kind: 'delete',
    data: [{ ...importItem, id: 'import-delete-1', custom_name: 'Delete should fail', custom_original_filename: 'safe.jar', owner_username: 'user', owner_email: 'user@example.invalid', custom_sha256: 'a'.repeat(64) }],
  },
];

function contained(base, filename) {
  const resolved = path.resolve(filename);
  const relative = path.relative(base, resolved);
  assert(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'Source path escaped its allowed root');
  return resolved;
}

function resolveSource(filename, specifier) {
  assert(specifier.startsWith('.'), `Unsupported browser import ${specifier}; use actual relative helpers`);
  const base = contained(webSource, path.resolve(path.dirname(filename), specifier));
  const found = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, path.join(base, 'index.ts')]
    .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  assert(found, `Missing actual source module ${specifier}`);
  return contained(fs.realpathSync(webSource), fs.realpathSync(found));
}

function compile(source, filename, caseId) {
  const result = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 },
    transformers: {
      before: [(context) => {
        const visit = (node) => {
          if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            const target = resolveSource(filename, node.moduleSpecifier.text);
            const isApi = target === path.join(webSource, 'lib/api.ts');
            const route = isApi ? '/_fixture/api.mjs' : `/_source/${path.relative(webSource, target).split(path.sep).map(encodeURIComponent).join('/')}`;
            const specifier = ts.factory.createStringLiteral(`${route}?case=${encodeURIComponent(caseId)}`);
            if (ts.isImportDeclaration(node)) {
              return ts.factory.updateImportDeclaration(node, node.modifiers, node.importClause, specifier, node.attributes);
            }
            return ts.factory.updateExportDeclaration(node, node.modifiers, node.isTypeOnly, node.exportClause, specifier, node.attributes);
          }
          return ts.visitEachChild(node, visit, context);
        };
        return (node) => ts.visitNode(node, visit);
      }],
    },
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics || []).filter((item) => item.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: (name) => name, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }));
  return result.outputText;
}

// This runs inside the real browser, after the actual page script and helper modules load.
async function verifyCase(test) {
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  await wait(200);
  const bodyText = () => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let value = ''; let node;
    while ((node = walker.nextNode())) {
      if (!node.parentElement?.closest('script, style, noscript')) value += node.textContent;
    }
    return value;
  };
  const table = document.querySelector('tbody');
  check(window.__pmReads > 0, 'Actual client script did not call the fixture API');
  check(window.__pmExecuted === 0, 'Injected event handler executed');
  check(!document.querySelector('.pm-injected, [data-pm-injected]'), 'Injected element or attribute reached the DOM');
  check(window.__pmScriptErrors.length === 0, `Client script errors: ${window.__pmScriptErrors.join('; ')}`);

  if (test.kind === 'imports-markup') {
    for (const field of ['custom_name', 'custom_original_filename', 'owner_username', 'owner_email']) {
      check(table.textContent.includes(test.data[0][field]), `${field} was not rendered as literal text`);
    }
    const hash = test.data[0].custom_sha256;
    check([...table.querySelectorAll('[title]')].some((element) => element.title === hash) || table.textContent.includes(hash), 'Hash text/attribute was corrupted by markup');
  }
  if (test.kind === 'storage-markup') {
    for (const field of ['asset_type', 'storage_key', 'original_filename', 'status']) {
      check(table.textContent.includes(test.data[0][field]), `${field} was not rendered as literal text`);
    }
    check([...table.querySelectorAll('a[href]')].some((anchor) => anchor.getAttribute('href') === test.data[0].url || anchor.href === new URL(test.data[0].url, location.href).href), 'Safe storage link was lost');
  }
  if (test.kind === 'links') {
    for (const anchor of table.querySelectorAll('a[href]')) {
      check(['http:', 'https:'].includes(new URL(anchor.href, location.href).protocol), `Unsafe href retained: ${anchor.getAttribute('href')}`);
    }
    check(table.textContent.includes('unsafe-js') && table.textContent.includes('unsafe-data'), 'Unsafe URL rows must remain visible as text');
    check([...table.querySelectorAll('a[href]')].some((anchor) => anchor.href === new URL(test.data[2].url, location.href).href), 'Safe URL was blocked with unsafe schemes');
  }
  if (test.kind === 'empty') {
    check(/Chưa có|trống|empty/i.test(table.textContent), 'Empty API result has no empty state');
    check(!bodyText().includes('PM_LOAD_FAILED'), 'Empty result incorrectly shows an API error');
  }
  if (test.kind === 'error') {
    check(bodyText().includes('PM_LOAD_FAILED') || window.__pmAlerts.some((message) => message.includes('PM_LOAD_FAILED')), 'API failure was hidden instead of displaying its error');
    check(!/Chưa có file game|Chưa có asset/i.test(table.textContent), 'API failure incorrectly presented as an empty result');
  }
  if (test.kind === 'delete') {
    const button = table.querySelector('button');
    check(!!button, 'No delete action was rendered');
    button?.click();
    await wait(100);
    check(window.__pmDeletes.length === 1, 'Delete action did not call the API exactly once');
    check(bodyText().includes('PM_DELETE_FAILED') || window.__pmAlerts.some((message) => message.includes('PM_DELETE_FAILED')), 'Failed delete has no feedback');
    check(table.textContent.includes('Delete should fail'), 'Failed delete removed the item from the table');
  }
  parent.postMessage({ type: 'pm-admin-result', id: test.id, failures, reads: window.__pmReads, executed: window.__pmExecuted }, location.origin);
}

function fixtureModule(test) {
  return `const test = ${JSON.stringify(test)};
    const load = async () => { window.__pmReads++; return test.kind === 'error'
      ? {success:false,error:{code:'PM_LOAD_FAILED',message:'PM_LOAD_FAILED'}}
      : {success:true,data:structuredClone(test.data)}; };
    export const getAdminImports = load;
    export const getAdminAssets = load;
    export async function apiRequest(endpoint, options = {}) {
      if (options.method === 'DELETE') { window.__pmDeletes.push(endpoint); return {success:false,error:{code:'PM_DELETE_FAILED',message:'PM_DELETE_FAILED'}}; }
      return load();
    }
    export async function getCurrentUser() { return {success:true,data:{id:'pm-admin',role:'ADMIN'}}; }
    export const getAuthToken = () => 'pm-fixture-only';
    export const logoutUser = () => {};
  `;
}

function actualPage(test, source) {
  const filename = path.join(webSource, pages[test.page]);
  const scripts = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert(scripts.length > 0, `No actual client script in ${filename}`);
  let index = 0;
  const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, '')
    .replace(/<AdminLayout\b[^>]*>/g, '<main>').replace(/<\/AdminLayout>/g, '</main>')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, () => `<script type="module" src="/_page-script/${test.id}/${index++}.mjs"></script>`);
  return `<!doctype html><meta charset="utf-8"><script>
    window.__pmReads=0; window.__pmExecuted=0; window.__pmAlerts=[]; window.__pmDeletes=[]; window.__pmScriptErrors=[];
    window.alert = message => window.__pmAlerts.push(String(message)); window.confirm=()=>true;
    addEventListener('error', event => { if(event.message) window.__pmScriptErrors.push(event.message); });
    addEventListener('unhandledrejection', event => window.__pmScriptErrors.push(String(event.reason)));
    </script>${body}<script>addEventListener('load', () => (${verifyCase.toString()})(${JSON.stringify(test).replace(/</g, '\\u003c')}));</script>`;
}

function runnerPage() {
  return `<!doctype html><meta charset="utf-8"><pre id="pm-result">RUNNING</pre><script>
    const cases = ${JSON.stringify(cases.map(({ id }) => id))};
    const results = []; const frames = new Map();
    function finish() { if(results.length===cases.length) document.getElementById('pm-result').textContent=JSON.stringify({results}); }
    addEventListener('message', event => {
      if(event.origin!==location.origin || event.data?.type!=='pm-admin-result' || frames.get(event.data.id)?.contentWindow!==event.source) return;
      if(results.some(result=>result.id===event.data.id)) return;
      results.push(event.data); finish();
    });
    for(const id of cases) { const frame=document.createElement('iframe'); frames.set(id,frame); frame.src='/case/'+id; document.body.append(frame); }
    setTimeout(()=>{for(const id of cases) if(!results.some(result=>result.id===id)) results.push({id,failures:['Browser case timed out']}); finish();},5000);
  </script>`;
}

async function run() {
  const browserArg = process.argv.indexOf('--browser');
  const browser = (browserArg >= 0 ? [process.argv[browserArg + 1]] : [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ]).find((candidate) => candidate && fs.existsSync(candidate));
  assert(browser, 'No installed Chrome/Edge found. Supply --browser <path>.');
  const sources = Object.fromEntries(Object.entries(pages).map(([key, relative]) => [key, fs.readFileSync(path.join(webSource, relative), 'utf8')]));
  const serverErrors = [];
  const server = http.createServer((request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const test = cases.find((item) => item.id === url.searchParams.get('case'));
      let content;
      let type = 'text/javascript; charset=utf-8';
      if (url.pathname === '/') { content = runnerPage(); type = 'text/html; charset=utf-8'; }
      else if (url.pathname.startsWith('/case/')) {
        const selected = cases.find((item) => item.id === url.pathname.slice(6));
        assert(selected, 'Unknown browser case'); content = actualPage(selected, sources[selected.page]); type = 'text/html; charset=utf-8';
      } else if (url.pathname === '/_fixture/api.mjs') { assert(test, 'Unknown API fixture'); content = fixtureModule(test); }
      else if (url.pathname.startsWith('/_page-script/')) {
        const [, , id, scriptIndex] = url.pathname.split('/');
        const selected = cases.find((item) => item.id === id); assert(selected, 'Unknown script case');
        const filename = path.join(webSource, pages[selected.page]);
        const scripts = [...sources[selected.page].matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
        assert(scripts[Number.parseInt(scriptIndex, 10)], 'Unknown actual page script');
        content = compile(scripts[Number.parseInt(scriptIndex, 10)][1], filename, id);
      } else if (url.pathname.startsWith('/_source/')) {
        assert(test, 'Unknown helper case');
        const filename = contained(webSource, path.join(webSource, decodeURIComponent(url.pathname.slice(9))));
        contained(fs.realpathSync(webSource), fs.realpathSync(filename));
        content = compile(fs.readFileSync(filename, 'utf8'), filename, test.id);
      } else { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); response.end(content);
    } catch (error) {
      serverErrors.push(error.message); response.writeHead(500, { 'Content-Type': 'text/plain' }); response.end(error.message);
    }
  });
  const tempRoot = fs.realpathSync(os.tmpdir());
  const profile = fs.mkdtempSync(path.join(tempRoot, 'gametuoitho-admin-render-'));
  let child;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const url = `http://127.0.0.1:${server.address().port}/`;
    const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-extensions', '--no-proxy-server', `--user-data-dir=${profile}`, '--virtual-time-budget=10000', '--dump-dom', url];
    const output = await new Promise((resolve, reject) => {
      child = spawn(browser, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('Own headless browser timed out after 30 seconds')); }, 30000);
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-3000); });
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('close', (code) => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error(`Own browser exited ${code}: ${stderr}`)); });
    });
    assert.equal(serverErrors.length, 0, `Fixture/source server failed: ${serverErrors.join('; ')}`);
    const match = output.match(/<pre id="pm-result">([\s\S]*?)<\/pre>/);
    assert(match && match[1] !== 'RUNNING', 'Browser did not finish DOM checks');
    const result = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    assert.equal(result.results.length, cases.length, 'Missing browser case results');
    let failures = 0;
    for (const test of result.results) {
      console.log(`${test.failures.length ? 'FAIL' : 'PASS'} ${test.id}${test.failures.length ? ': ' + test.failures.join('; ') : ''}`);
      failures += test.failures.length > 0 ? 1 : 0;
    }
    console.log(`DOM review: ${cases.length - failures}/${cases.length} cases passed. Actual Astro scripts + actual relative helpers; fixture API only.`);
    process.exitCode = failures ? 1 : 0;
  } finally {
    if (child && child.exitCode === null) child.kill();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    // Delete only the isolated profile created by this process, after checking its absolute parent/prefix.
    assert.equal(path.dirname(path.resolve(profile)), tempRoot);
    assert(path.basename(profile).startsWith('gametuoitho-admin-render-'));
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}

run().catch((error) => { console.error(`DOM review could not complete: ${error.message}`); process.exitCode = 1; });
