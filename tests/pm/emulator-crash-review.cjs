// Exercises the actual emulator console bridge and React player, without a JVM,
// network, game execution, or database writes. Run: node tests/pm/emulator-crash-review.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const ts = require(path.join(root, 'node_modules/typescript'));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const diagnosticsSource = read('apps/emulator-web/src/diagnostics.js');
const mainSource = ts.createSourceFile('main.js', read('apps/emulator-web/src/main.js'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
// Preserve the real message registration/showError; only imports and automatic
// CheerpJ startup are replaced. Calling init or any Java native is prohibited here.
const inertMain = ts.createPrinter().printFile(ts.factory.updateSourceFile(mainSource,
  mainSource.statements.filter(statement => !ts.isImportDeclaration(statement) &&
    !(ts.isExpressionStatement(statement) && statement.getText(mainSource).startsWith('init().catch(')))));
const playerSource = ts.transpileModule(read('apps/web/src/components/EmulatorPlayer.tsx'), {
  fileName: 'EmulatorPlayer.tsx',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const nokiaSource = ts.transpileModule(read('apps/web/src/components/Nokia1280.tsx'), {
  fileName: 'Nokia1280.tsx',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
let passed = 0;
async function test(name, run) { await run(); passed++; console.log(`PASS ${name}`); }

function emulator(onMessage = () => {}) {
  const sent = [];
  const consoleCalls = [];
  const timers = new Map();
  let now = 0, nextTimer = 0;
  const loading = { hidden: true, innerHTML: '' };
  const origin = 'https://game.example.test';
  const window = { location: { origin }, parent: { postMessage(message, target) { sent.push({ message, target }); onMessage(message); } } };
  const context = vm.createContext({
    window, location: { search: '', pathname: '/emulator/run.html' },
    URLSearchParams, localStorage: { getItem: () => null },
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => consoleCalls.push({ level, args })])),
    document: { getElementById: id => id === 'loading' ? loading : null },
    EventQueue: class {}, KeyRepeatManager: class {}, KeyMapper: class {},
    setTimeout: (callback, ms) => { const id = ++nextTimer; timers.set(id, { callback, at: now + ms }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(diagnosticsSource, context, { filename: 'diagnostics.js' });
  vm.runInContext(inertMain, context, { filename: 'main.js' });
  function advance(ms) {
    const until = now + ms;
    let iterations = 0;
    while (true) {
      const due = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      assert.ok(++iterations < 100, 'timer callbacks must settle');
      now = due[1].at; timers.delete(due[0]); due[1].callback();
    }
    now = until;
  }
  return { context, sent, loading, consoleCalls, advance, log: value => context.console.log(value) };
}

function walk(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const found = walk(child, predicate); if (found) return found; }
  return null;
}
function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  return [node.props?.children].flat(Infinity).map(text).join(' ');
}

function player(reportResult = () => Promise.resolve({ success: true, data: { id: 'report-1' } })) {
  const calls = [];
  const state = [], refs = [], effects = [], listeners = new Map(), errors = [];
  let stateIndex = 0, refIndex = 0, mounted = false;
  const iframeWindow = {};
  const window = {
    location: { origin: 'https://game.example.test' }, history: { length: 1 },
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: type => listeners.delete(type),
  };
  const React = {
    createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = stateIndex++;
      if (!Object.hasOwn(state, index)) state[index] = initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
    useRef(initial) { const index = refIndex++; return refs[index] ||= { current: initial }; },
    useEffect(callback) { if (!mounted) effects.push(callback); },
  };
  const module = { exports: {} };
  const nokia = { exports: {} };
  vm.runInNewContext(nokiaSource, {
    module: nokia, exports: nokia.exports,
    require: name => { if (name === 'react') return { __esModule: true, default: React, ...React }; if (name.endsWith('.css')) return {}; throw new Error(name); },
  });
  const context = vm.createContext({
    module, exports: module.exports, window, document: { addEventListener() {}, removeEventListener() {} },
    console: { error: (...args) => errors.push(args) },
    require(name) {
      if (name.endsWith('.css')) return {};
      if (name === 'react') return { __esModule: true, default: React, ...React };
      if (name === './Nokia1280') return nokia.exports;
      if (name === '../lib/api') return {
        recordPlay: () => Promise.resolve({ success: true }),
        reportGameCrash: payload => { calls.push(payload); return reportResult(payload); },
      };
      if (name === '../constants/keyMapping') return { DEFAULT_KEY_MAPPINGS: [], KEYBOARD_HINT_MESSAGE: '', DEFAULT_KEYS_NOTE: '' };
      if (name === '../lib/touchKeypad') return { bindTouchKeypad() { throw new Error('No DOM keypad in this crash-only fixture'); } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  vm.runInContext(playerSource, context, { filename: 'EmulatorPlayer.js' });
  const props = { game: { id: 'game-1', name: 'Thach Sanh', slug: 'thach-sanh' }, activeVersion: { id: 'version-2', jar_url: '/api/v1/assets/raw/game.jar' } };
  function render() {
    stateIndex = 0; refIndex = 0;
    return module.exports.default(props);
  }
  const first = render();
  const iframe = walk(first, node => node.type === 'iframe');
  assert.ok(iframe, 'actual player must render an iframe');
  iframe.props.ref.current = { contentWindow: iframeWindow, src: iframe.props.src };
  effects.forEach(effect => effect()); mounted = true;
  return {
    calls, errors, iframeWindow, render,
    loadFrame() {
      const currentIframe = walk(render(), node => node.type === 'iframe');
      assert.equal(typeof currentIframe?.props.onLoad, 'function', 'each actual iframe must reset launch state on load');
      currentIframe.props.onLoad();
    },
    emit(data, overrides = {}) { listeners.get('message')({ origin: window.location.origin, source: iframeWindow, data, ...overrides }); },
  };
}

const crash = { type: 'EMULATOR_ERROR', errorType: 'CRASH', message: 'Runtime crashed', stack: 'java.lang.NullPointerException\n\tat example.Menu.draw(Menu.java:12)\nCaused by: java.io.IOException: root cause' };
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

(async () => {
  for (const marker of ['Error Running Jar', 'Problem with setCurrent(next)']) {
    await test(`${marker}: Java console -> real bridge -> versioned report`, async () => {
      const parent = player();
      const runtime = emulator(message => parent.emit(message));
      runtime.log(marker.slice(0, 8)); runtime.log(marker.slice(8) + '\n');
      runtime.log('java.lang.NullPointerException\n');
      runtime.log('\tat pl.zb3.freej2me.bridge.graphics.CanvasGraphics.drawImage(Unknown Source)\n');
      runtime.log('Caused by: java.io.IOException: nested reason\n');
      assert.equal(runtime.sent.length, 0, 'wait for Java stack before reporting');
      runtime.advance(250); await settle();
      assert.equal(runtime.sent.length, 1);
      assert.equal(runtime.sent[0].target, 'https://game.example.test');
      assert.equal(runtime.sent[0].message.errorType, 'CRASH');
      assert.equal(parent.calls.length, 1);
      assert.equal(parent.calls[0].game_id, 'game-1');
      assert.equal(parent.calls[0].game_version_id, 'version-2');
      assert.match(parent.calls[0].stack_trace, /CanvasGraphics\.drawImage/);
      assert.match(parent.calls[0].stack_trace, /Caused by: java\.io\.IOException: nested reason/);
      assert.match(text(parent.render()), /Đã gửi log lỗi tới quản trị/);
      runtime.log(marker + '\n'); runtime.advance(2000); parent.emit(crash); await settle();
      assert.equal(parent.calls.length, 1, 'duplicate native and promise failures must not spam reports');
      assert.equal(runtime.loading.hidden, false);
      assert.ok(runtime.consoleCalls.length >= 5, 'normal browser console output is preserved');
    });
  }
  await test('healthy Java output and arbitrary objects do not trigger a crash', () => {
    const runtime = emulator();
    runtime.log('Create MIDlet\nFont ok !!!\njava.lang.Exception: recovered by game\n');
    runtime.log({ toString() { throw new Error('Must not traverse objects'); } });
    runtime.advance(5000);
    assert.equal(runtime.sent.length, 0);
    assert.equal(runtime.loading.hidden, true);
  });
  await test('large Java stack stays bounded and retains nested cause; credentials are redacted', () => {
    const runtime = emulator();
    runtime.log('Error Running Jar\nAuthorization: Bearer sample-token\naccess_token=sample-secret\n');
    for (let i = 0; i < 300; i++) runtime.log(`\tat example.Frame${i}.call(Unknown Source)\n`);
    runtime.log('Caused by: java.lang.IllegalStateException: final cause\n');
    runtime.advance(250);
    const stack = runtime.sent[0].message.stack;
    assert.ok(stack.length <= 8000);
    assert.match(stack, /Error Running Jar/);
    assert.match(stack, /Caused by: java.lang.IllegalStateException: final cause/);
    assert.doesNotMatch(stack, /sample-token|sample-secret/);
  });
  await test('error UI escapes game-controlled strings and reports explicit load failures once', () => {
    const runtime = emulator();
    vm.runInContext(`showError('<img src=x onerror="alert(1)">', false); showError('second failure');`, runtime.context);
    assert.equal(runtime.sent.length, 1);
    assert.equal(runtime.sent[0].message.errorType, 'LOAD_FAILED');
    // A fresh launch tests the rendered string before a later display replaces it.
    const escaped = emulator();
    vm.runInContext(`showError('<img src=x onerror="alert(1)">', false);`, escaped.context);
    assert.match(escaped.loading.innerHTML, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
    assert.doesNotMatch(escaped.loading.innerHTML, /<img src=x/);
  });
  await test('parent ignores unrelated same-origin frames and wrong origins', async () => {
    const parent = player();
    parent.emit(crash, { source: {} });
    parent.emit(crash, { origin: 'https://other.example.test' });
    parent.emit(null);
    await settle(); assert.equal(parent.calls.length, 0);
    parent.emit(crash); await settle(); assert.equal(parent.calls.length, 1);
  });
  for (const [label, result, expected] of [
    ['API refusal', () => Promise.resolve({ success: false, error: { message: 'Rate limit reached' } }), 'Rate limit reached'],
    ['network rejection', () => Promise.reject(new Error('Network unavailable')), 'Network unavailable'],
  ]) {
    await test(`${label} is shown to the player instead of silent success`, async () => {
      const parent = player(result); parent.emit(crash); await settle();
      assert.match(text(parent.render()), /Chưa gửi được log lỗi/);
      assert.ok(text(parent.render()).includes(expected));
      assert.ok(parent.errors.length);
      assert.doesNotMatch(text(parent.render()), /Đã gửi log lỗi tới quản trị/);
    });
  }
  await test('retry allows one new report for the next launch', async () => {
    const parent = player(); parent.emit(crash); await settle();
    const retry = walk(parent.render(), node => node.type === 'button' && text(node).trim() === 'Thử lại');
    assert.ok(retry); retry.props.onClick();
    parent.emit(crash); await settle(); assert.equal(parent.calls.length, 2);
  });
  await test('iframe reload clears previous error/status and allows the next launch report', async () => {
    const parent = player(); parent.emit(crash); await settle();
    assert.match(text(parent.render()), /Runtime crashed/);
    parent.loadFrame();
    assert.doesNotMatch(text(parent.render()), /Runtime crashed|Đã gửi log lỗi tới quản trị/);
    parent.emit(crash); await settle(); assert.equal(parent.calls.length, 2);
  });
  console.log(`${passed}/${passed} emulator crash regression cases passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
