// Execute the real worker source against an in-memory browser Cache/Fetch model.
// No servers, network, game execution or disk writes.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const workers = [
  'apps/emulator-web/sw.js',
  'apps/web/public/emulator/sw.js',
];
const site = 'https://game.fixture';
const bootstrap = `${site}/emulator/src/main.js`;
const runtime = 'https://cjrtnc.leaningtech.com/4.1/loader.js';

// Browser fetch supplies basic/cors responses. Node's Response constructor uses
// "default", so model that browser metadata explicitly, including on clone().
function response(text, options = {}) {
  const { type = 'basic', redirected = false, ...init } = options;
  const result = new Response(init.status === 304 ? null : text, init);
  Object.defineProperty(result, 'type', { value: type });
  Object.defineProperty(result, 'redirected', { value: redirected });
  const clone = result.clone.bind(result);
  result.clone = () => {
    const copied = clone();
    return responseFromClone(copied, type, redirected);
  };
  return result;
}

function responseFromClone(result, type, redirected) {
  Object.defineProperty(result, 'type', { value: type });
  Object.defineProperty(result, 'redirected', { value: redirected });
  const clone = result.clone.bind(result);
  result.clone = () => responseFromClone(clone(), type, redirected);
  return result;
}

function harness(source, scope = `${site}/emulator/`) {
  const listeners = new Map();
  const stores = new Map();
  const calls = { fetch: [], open: [], put: [], remove: [], precache: [], warnings: [], skip: 0, claim: 0 };
  const behavior = { fetch: () => response('fresh'), failOpen: false, failPut: false, beforePut: null };
  const key = request => typeof request === 'string' ? request : request.url;
  const caches = {
    async open(name) {
      calls.open.push(name);
      if (behavior.failOpen) throw new Error('synthetic cache unavailable');
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async match(request) { return entries.get(key(request))?.clone(); },
        async put(request, value) {
          calls.put.push({ name, url: key(request) });
          if (behavior.beforePut) await behavior.beforePut();
          if (behavior.failPut) throw new Error('synthetic cache quota failure');
          entries.set(key(request), value.clone());
        },
        async delete(request) { return entries.delete(key(request)); },
        async addAll(urls) { calls.precache.push(...urls); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { calls.remove.push(name); return stores.delete(name); },
  };
  const self = {
    registration: { scope },
    location: new URL(scope),
    addEventListener(name, listener) { listeners.set(name, listener); },
    async skipWaiting() { calls.skip += 1; },
    clients: { async claim() { calls.claim += 1; } },
  };
  vm.runInNewContext(source, {
    self, caches, URL,
    fetch: async (request, init) => { calls.fetch.push({ request, init }); return behavior.fetch(request, init); },
    console: { log() {}, warn(...args) { calls.warnings.push(args); }, error() {} },
  }, { filename: 'emulator-sw-under-review.js' });
  function dispatch(url = bootstrap, options = {}) {
    let result;
    const event = {
      request: new Request(url, options),
      respondWith(value) { assert.equal(result, undefined, 'respondWith may only be called once'); result = Promise.resolve(value); },
    };
    listeners.get('fetch')(event);
    return { handled: result !== undefined, result };
  }
  async function fetchResponse(url = bootstrap, options = {}) {
    const event = dispatch(url, options);
    assert.equal(event.handled, true, 'eligible request must be handled by worker');
    return event.result;
  }
  async function lifecycle(name) {
    const pending = [];
    listeners.get(name)({ waitUntil(value) { pending.push(value); } });
    await Promise.all(pending);
  }
  return { stores, calls, behavior, dispatch, fetchResponse, lifecycle };
}

const tests = [];
function test(name, run) { tests.push({ name, run }); }

test('installation does not prefetch a hardcoded deployment path', async source => {
  const h = harness(source, `${site}/a/different/player/`);
  await h.lifecycle('install');
  assert.equal(h.calls.skip, 1);
  assert.deepEqual(h.calls.precache, []);
  assert.deepEqual(h.calls.fetch, []);
});

test('activation removes only old freej2me caches and claims clients', async source => {
  const h = harness(source);
  await h.fetchResponse();
  const currentName = h.calls.put[0].name;
  h.stores.set('freej2me-cache-v1', new Map());
  h.stores.set('freej2me-cache-v1-runtime', new Map());
  h.stores.set('unrelated-app-cache', new Map());
  h.stores.set('freej2me-cache', new Map());
  await h.lifecycle('activate');
  assert.ok(h.stores.has(currentName), 'current worker cache survives activation');
  assert.ok(h.stores.has('unrelated-app-cache'));
  assert.ok(h.stores.has('freej2me-cache'), 'name outside the required prefix survives');
  assert.deepEqual(h.calls.remove.sort(), ['freej2me-cache-v1', 'freej2me-cache-v1-runtime']);
  assert.equal(h.calls.claim, 1);
});

for (const pathname of ['src/main.js', 'src/module.mjs', 'run.html', 'style.css', '']) {
  test(`local bootstrap ${pathname || '/'} uses fresh network content`, async source => {
    const h = harness(source);
    const url = `${site}/emulator/${pathname}`;
    h.behavior.fetch = () => response('old bootstrap');
    assert.equal(await (await h.fetchResponse(url)).text(), 'old bootstrap');
    h.behavior.fetch = () => response('new bootstrap');
    assert.equal(await (await h.fetchResponse(url)).text(), 'new bootstrap');
    assert.equal(h.calls.fetch.length, 2, 'cached bootstrap must not prevent network refresh');
    assert.equal(h.calls.fetch[1].init?.cache, 'no-cache', 'HTTP cache must be revalidated too');
  });
}

test('local bootstrap can use its current cached copy on a real network failure', async source => {
  const h = harness(source);
  h.behavior.fetch = () => response('available offline');
  await h.fetchResponse();
  h.behavior.fetch = () => { throw new TypeError('synthetic offline'); };
  assert.equal(await (await h.fetchResponse()).text(), 'available offline');
});

for (const status of [404, 500]) {
  test(`HTTP ${status} never falls back to stale bootstrap`, async source => {
    const h = harness(source);
    h.behavior.fetch = () => response('old bootstrap');
    await h.fetchResponse();
    h.behavior.fetch = () => response('actual HTTP error', { status });
    const result = await h.fetchResponse();
    assert.equal(result.status, status);
    assert.equal(await result.text(), 'actual HTTP error');
    h.behavior.fetch = () => { throw new TypeError('synthetic offline'); };
    await assert.rejects(h.fetchResponse(), /synthetic offline/, 'the known-bad fallback must have been evicted');
  });
}

test('scope comes from registration and does not include neighboring app paths', async source => {
  const h = harness(source, `${site}/different/player/`);
  assert.equal((await h.fetchResponse(`${site}/different/player/main.js`)).status, 200);
  assert.equal(h.dispatch(`${site}/emulator/main.js`).handled, false);
  assert.equal(h.dispatch(`${site}/different/player-other/main.js`).handled, false);
});

const bypasses = [
  ['private API with a jar suffix', `${site}/api/v1/assets/raw/private.jar`, {}],
  ['API with a js suffix', `${site}/api/v1/sensitive.js`, {}],
  ['API root', `${site}/api`, {}],
  ['dynamic game JAR inside emulator', `${site}/emulator/jar/game.jar`, {}],
  ['dynamic game JAR outside emulator', `${site}/uploads/game.jar`, {}],
  ['local emulator JAR is not a bootstrap cache', `${site}/emulator/freej2me-web.jar`, {}],
  ['JS outside registration', `${site}/app/main.js`, {}],
  ['similar scope prefix', `${site}/emulator-other/main.js`, {}],
  ['cross origin application JS', 'https://other.fixture/emulator/main.js', {}],
  ['versionless CDN path', 'https://cjrtnc.leaningtech.com/loader.js', {}],
  ['untrusted HTTP CDN origin', 'http://cjrtnc.leaningtech.com/4.1/loader.js', {}],
  ['lookalike CDN host', 'https://cjrtnc.leaningtech.com.other.fixture/4.1/loader.js', {}],
  ['local byte range', bootstrap, { headers: { Range: 'bytes=0-10' } }],
  ['runtime byte range', runtime, { headers: { Range: 'bytes=0-10' } }],
  ['authorized bootstrap', bootstrap, { headers: { Authorization: 'Bearer synthetic-fixture-only' } }],
  ['authorized runtime', runtime, { headers: { Authorization: 'Bearer synthetic-fixture-only' } }],
  ['cookie-bearing request when visible', bootstrap, { headers: { Cookie: 'fixture_session=synthetic' } }],
  ['request cache no-store', bootstrap, { cache: 'no-store' }],
  ['runtime request cache no-store', runtime, { cache: 'no-store' }],
  ['request cache reload', runtime, { cache: 'reload' }],
  ['request no-store header', bootstrap, { headers: { 'Cache-Control': 'max-age=0, no-store' } }],
  ['request private header', bootstrap, { headers: { 'Cache-Control': 'private' } }],
  ['request no-cache header', runtime, { headers: { 'Cache-Control': 'no-cache' } }],
  ['request pragma no-cache', runtime, { headers: { Pragma: 'no-cache' } }],
  ['HEAD', bootstrap, { method: 'HEAD' }],
  ['POST', bootstrap, { method: 'POST' }],
];
for (const [name, url, options] of bypasses) {
  test(`bypass: ${name}`, async source => {
    const h = harness(source);
    assert.equal(h.dispatch(url, options).handled, false, 'browser must handle this request without worker interception');
    assert.equal(h.calls.fetch.length, 0);
    assert.equal(h.calls.open.length, 0);
    assert.equal(h.calls.put.length, 0);
  });
}

test('versioned CheerpJ runtime is immutable and isolated by version', async source => {
  const h = harness(source);
  h.behavior.fetch = () => response('4.1 immutable runtime', { type: 'cors' });
  assert.equal(await (await h.fetchResponse(runtime)).text(), '4.1 immutable runtime');
  h.behavior.fetch = () => response('4.2 runtime', { type: 'cors' });
  assert.equal(await (await h.fetchResponse(runtime)).text(), '4.1 immutable runtime');
  assert.equal(h.calls.fetch.length, 1);
  assert.equal(await (await h.fetchResponse(runtime.replace('/4.1/', '/4.2/'))).text(), '4.2 runtime');
  assert.equal(h.calls.fetch.length, 2);
  assert.notEqual(h.calls.put[0].name, h.calls.put[1].name);
  assert.match(h.calls.put[0].name, /4\.1/);
  assert.match(h.calls.put[1].name, /4\.2/);
});

for (const control of ['no-store', 'private, max-age=100', 'no-cache']) {
  for (const url of [bootstrap, runtime]) {
    test(`response ${control} is never reused: ${url === runtime ? 'runtime' : 'bootstrap'}`, async source => {
      const h = harness(source);
      h.behavior.fetch = () => response('uncacheable response', { type: url === runtime ? 'cors' : 'basic', headers: { 'Cache-Control': control } });
      assert.equal(await (await h.fetchResponse(url)).text(), 'uncacheable response');
      assert.equal(await (await h.fetchResponse(url)).text(), 'uncacheable response');
      assert.equal(h.calls.put.length, 0);
      assert.equal(h.calls.fetch.length, 2);
    });
  }
}

test('a new private response evicts an old public offline fallback', async source => {
  const h = harness(source);
  await h.fetchResponse();
  h.behavior.fetch = () => response('now private', { headers: { 'Cache-Control': 'private, no-store' } });
  assert.equal(await (await h.fetchResponse()).text(), 'now private');
  h.behavior.fetch = () => { throw new TypeError('synthetic offline'); };
  await assert.rejects(h.fetchResponse(), /synthetic offline/);
});

for (const options of [
  { status: 206 }, { status: 304 }, { status: 404 }, { type: 'opaque' },
  { type: 'opaqueredirect' }, { type: 'default' }, { redirected: true },
  { headers: { 'Set-Cookie': 'fixture=synthetic' } }, { headers: { Vary: '*' } },
]) {
  test(`only cache safe 200 basic/cors responses: ${JSON.stringify(options)}`, async source => {
    const h = harness(source);
    h.behavior.fetch = () => response('not reusable', options);
    await h.fetchResponse();
    assert.equal(h.calls.put.length, 0);
  });
}

test('cache.put is awaited before returning the response', async source => {
  const h = harness(source);
  let release;
  let entered = false;
  h.behavior.beforePut = () => {
    entered = true;
    return new Promise(resolve => { release = resolve; });
  };
  let settled = false;
  const result = h.fetchResponse().then(value => { settled = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(entered, true);
  assert.equal(settled, false, 'worker lifetime must cover the cache write');
  release();
  assert.equal((await result).status, 200);
});

for (const url of [bootstrap, runtime]) {
  test(`cache write failure preserves network response: ${url === runtime ? 'runtime' : 'bootstrap'}`, async source => {
    const h = harness(source);
    h.behavior.failPut = true;
    const result = await h.fetchResponse(url);
    assert.equal(result.status, 200);
    assert.equal(await result.text(), 'fresh');
    assert.equal(h.calls.warnings.length, 1);
  });
  test(`unavailable Cache API preserves network response: ${url === runtime ? 'runtime' : 'bootstrap'}`, async source => {
    const h = harness(source);
    h.behavior.failOpen = true;
    assert.equal(await (await h.fetchResponse(url)).text(), 'fresh');
  });
}

test('runtime network errors propagate instead of inventing a response', async source => {
  const h = harness(source);
  h.behavior.fetch = () => { throw new TypeError('synthetic runtime offline'); };
  await assert.rejects(h.fetchResponse(runtime), /synthetic runtime offline/);
});

(async () => {
  let passed = 0;
  let failed = 0;
  for (const worker of workers) {
    const source = readFileSync(path.resolve(__dirname, '../..', worker), 'utf8');
    for (const item of tests) {
      try {
        await item.run(source);
        passed += 1;
      } catch (error) {
        failed += 1;
        console.error(`FAIL ${worker}: ${item.name}: ${error.message}`);
      }
    }
  }
  console.log(`PM emulator cache: ${passed + failed} checks; ${passed} passed; ${failed} failed. Both worker copies; mocked network/cache only.`);
  if (failed) process.exitCode = 1;
})().catch(error => {
  console.error('PM emulator cache harness failed:', error);
  process.exitCode = 1;
});
