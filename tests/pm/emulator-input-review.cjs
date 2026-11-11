// Actual input bridge/queue/player code, without a JVM, game execution or network.
// node tests/pm/emulator-input-review.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const ts = require(path.join(root, 'node_modules/typescript'));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const compile = (source, file) => ts.transpileModule(source, { fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
function loadModule(file) {
  const module = { exports: {} };
  vm.runInNewContext(compile(read(file), file), { module, exports: module.exports, console, setTimeout, clearTimeout, setInterval, clearInterval });
  return module.exports;
}
const { codeMap, keySymbol, KeyRepeatManager } = loadModule('apps/emulator-web/src/key.js');
const { EventQueue } = loadModule('apps/emulator-web/src/eventqueue.js');
const { canvasPoint, bindCanvasPointerEvents } = loadModule('apps/emulator-web/src/pointer.js');
const { bindTouchKeypad } = loadModule('apps/web/src/lib/touchKeypad.ts');
const audioModule = import('data:text/javascript;base64,' + Buffer.from(read('apps/emulator-web/libmidi/libmidi.js')).toString('base64'));
let resumeAudioContext;
let passed = 0;
async function test(name, run) { await run(); passed++; console.log(`PASS ${name}`); }
const settle = promise => Promise.race([promise, new Promise((_, reject) => {
  const timer = setTimeout(() => reject(new Error('Event queue stalled')), 100);
  promise.finally(() => clearTimeout(timer));
})]);
const plain = value => JSON.parse(JSON.stringify(value));
function eventTarget(extra = {}) {
  const listeners = new Map();
  return { ...extra, addEventListener(type, fn) { (listeners.get(type) || listeners.set(type, []).get(type)).push(fn); },
    removeEventListener() {}, emit(type, event = {}) { for (const fn of listeners.get(type) || []) fn({ type, preventDefault() {}, ...event }); } };
}

async function bridge() {
  const rect = { left: 19, top: 47, width: 180, height: 240 };
  const canvas = eventTarget({ width: 240, height: 320, style: {}, focus() {}, setPointerCapture() {}, getBoundingClientRect: () => rect, getContext: () => ({ canvas }) });
  const window = eventTarget({ location: { origin: 'https://fixture.invalid' }, parent: {}, innerWidth: 180, innerHeight: 240 });
  const document = eventTarget({ hidden: false, querySelector: () => ({ textContent: '' }), getElementById: id => id === 'display' ? canvas : { style: {} } });
  let natives;
  const file = 'apps/emulator-web/src/main.js';
  const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const inert = ts.createPrinter().printFile(ts.factory.updateSourceFile(ast, ast.statements.filter(node =>
    !ts.isImportDeclaration(node) && !(ts.isExpressionStatement(node) && node.getText(ast).startsWith('init().catch(')))));
  const context = vm.createContext({ window, document, location: { search: '?jar=/fixture.jar', pathname: '/emulator/run.html' }, URLSearchParams,
    codeMap, keySymbol, KeyRepeatManager, EventQueue, bindCanvasPointerEvents, resumeAudioContext,
    KeyMapper: class { getActionForKey(code) { return code === 'Digit5' ? 'UP' : null; } getDefaultKeysForAction() { return ['ArrowUp']; } },
    setKbdHandler(handler) { context.screenKey = handler; }, initKbdListeners() {}, kbdWidth: 220, kbdHeight: 220,
    LibMidi: class { midiPlayer = { addEventListener() {} }; async init() {} }, LibMedia: class {}, createUnlockingAudioContext() {},
    canvasFontNatives: {}, canvasGraphicsNatives: {}, gles2Natives: {}, jsReferenceNatives: {}, mediaBridgeNatives: {}, midiBridgeNatives: {},
    cheerpjInit: async options => { natives = options.natives; },
    cheerpjRunLibrary: async () => ({ org: { recompile: { freej2me: { FreeJ2ME: { main: async () => {} } } } } }),
    cheerpOSAddStringFile() {}, fetch: async () => ({ ok: true, arrayBuffer: async () => { const bytes = new Uint8Array(22); bytes[0] = 80; bytes[1] = 75; return bytes.buffer; } }),
    AbortSignal, localStorage: { getItem: () => null }, console: { log() {}, error() {} }, setTimeout, clearTimeout, setInterval, clearInterval,
  });
  vm.runInContext(inert, context);
  await vm.runInContext('init()', context);
  // The real JVM starts polling once the game's display is ready.
  window.evtQueue.started = true;
  const delivered = [];
  const lib = { pl: { zb3: { freej2me: { bridge: { shell: {
    KeyEvent: class { constructor(code, char, ctrl, shift) { assert.equal(typeof char, 'number'); assert.ok(Number.isInteger(char)); Object.assign(this, { code, char, ctrl, shift }); } },
    PointerEvent: class { constructor(x, y) { assert.ok(Number.isInteger(x) && Number.isInteger(y)); Object.assign(this, { x, y }); } },
  } } } } } };
  const listener = Object.fromEntries(['keyPressed', 'keyReleased', 'pointerPressed', 'pointerDragged', 'pointerReleased'].map(kind => [kind, async event => delivered.push({ kind, ...event })]));
  const dispatch = () => natives.Java_pl_zb3_freej2me_bridge_shell_Shell_waitForAndDispatchEvents(lib, listener);
  return { window, document, canvas, delivered, dispatch, screenKey: context.screenKey,
    key(code, pressed, overrides = {}) { window.emit('message', { source: window.parent, origin: window.location.origin, data: { type: 'KEY_EVENT', code, pressed }, ...overrides }); } };
}

async function main() {
  ({ resumeAudioContext } = await audioModule);
  await test('numeric Java chars for every phone key, including 5, * and #', () => {
    for (let i = 0; i < 10; i++) { assert.equal(keySymbol(`Digit${i}`), 48 + i); assert.equal(keySymbol(`Numpad${i}`), 48 + i); }
    for (const key of ['Enter', 'F1', 'F2', 'ArrowUp', 'Escape']) assert.equal(keySymbol(key), 0);
    assert.equal(keySymbol('NumpadMultiply'), 42); assert.equal(keySymbol('NumpadDivide'), 35);
    assert.equal(keySymbol('KeyA', 'a'), 97);
  });
  await test('queue drains a burst and its final release without waiting for another key', async () => {
    const queue = new EventQueue(); const first = queue.waitForEvent();
    queue.queueEvent({ kind: 'down' }); queue.queueEvent({ kind: 'up' });
    assert.equal((await settle(first)).kind, 'down'); assert.equal((await settle(queue.waitForEvent())).kind, 'up');
    const next = queue.waitForEvent(); await Promise.resolve(); queue.queueEvent({ kind: 'next' });
    assert.equal((await settle(next)).kind, 'next');
  });
  await test('queue never returns undefined after a resolved wake-up has been drained', async () => {
    const queue = new EventQueue(); queue.started = true; queue.queueEvent({ kind: 'first' });
    assert.equal((await queue.waitForEvent()).kind, 'first');
    const next = queue.waitForEvent(); await Promise.resolve(); await Promise.resolve();
    queue.queueEvent({ kind: 'second' }); assert.equal((await settle(next)).kind, 'second');
  });
  await test('click coordinates account for canvas resolution, fractional zoom and viewport offsets', () => {
    const canvas = { width: 240, height: 320, getBoundingClientRect: () => ({ left: 23, top: 65, width: 150, height: 200 }) };
    assert.deepEqual(plain(canvasPoint(canvas, 98, 165)), { x: 120, y: 160 });
    assert.deepEqual(plain(canvasPoint(canvas, -100, 900)), { x: 0, y: 319 });
    assert.equal(canvasPoint(canvas, NaN, 10), null);
  });
  await test('actual parent-message bridge delivers all Nokia keys and releases with Java-compatible arguments', async () => {
    const runtime = await bridge();
    for (const code of ['F1', 'F2', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ...Array.from({ length: 10 }, (_, i) => `Digit${i}`), 'NumpadMultiply', 'NumpadDivide']) {
      const pending = runtime.dispatch(); runtime.key(code, true); runtime.key(code, false);
      await settle(pending); await settle(runtime.dispatch());
      const [down, up] = runtime.delivered.slice(-2);
      assert.equal(down.kind, 'keyPressed'); assert.equal(up.kind, 'keyReleased'); assert.equal(down.code, codeMap[code]); assert.equal(down.char, keySymbol(code));
    }
    assert.equal(runtime.delivered.find(item => item.code === 53)?.char, 53, 'virtual 5 ignores a custom PC mapping to Up');
    runtime.key('Digit5', true, { source: {} }); runtime.key('Digit5', true, { origin: 'https://untrusted.invalid' });
    runtime.key('__proto__', true); runtime.key('not-a-key', true);
    const pending = runtime.dispatch(); runtime.screenKey(true, 'Digit5'); runtime.screenKey(false, 'Digit5'); await settle(pending); await settle(runtime.dispatch());
    assert.equal(runtime.delivered.at(-1).code, 53);
  });
  await test('touch, drag, cancel and mouse after touch reach the real Java pointer bridge', async () => {
    const runtime = await bridge();
    for (const pointerType of ['touch', 'mouse']) {
      const pending = runtime.dispatch(); const event = { pointerId: 1, pointerType, button: 0, clientX: 109, clientY: 167 };
      runtime.canvas.emit('pointerdown', event); runtime.canvas.emit('pointermove', { ...event, clientX: 154 }); runtime.canvas.emit('pointercancel', event);
      await settle(pending); await settle(runtime.dispatch()); await settle(runtime.dispatch());
      assert.deepEqual(runtime.delivered.slice(-3).map(item => item.kind), ['pointerPressed', 'pointerDragged', 'pointerReleased']);
      assert.equal(runtime.delivered.at(-3).x, 120); assert.equal(runtime.delivered.at(-3).y, 160);
    }
  });
  await test('player captures touch, supports simultaneous keys and releases once on cancellation/background', () => {
    const window = eventTarget({ location: { origin: 'https://fixture.invalid' } }), document = eventTarget({ hidden: false });
    const refs = [], effects = [], messages = []; let refIndex = 0;
    const React = { createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : ({ type, props: { ...props, children } }), useState: value => [value, () => {}], useRef: value => refs[refIndex++] ||= { current: value }, useEffect: callback => effects.push(callback) };
    const nokia = { exports: {} };
    vm.runInNewContext(compile(read('apps/web/src/components/Nokia1280.tsx'), 'Nokia1280.tsx'), {
      module: nokia, exports: nokia.exports,
      require: name => { if (name === 'react') return { __esModule: true, default: React, ...React }; if (name.endsWith('.css')) return {}; throw new Error(name); },
    });
    const module = { exports: {} };
    vm.runInNewContext(compile(read('apps/web/src/components/EmulatorPlayer.tsx'), 'EmulatorPlayer.tsx'), { module, exports: module.exports, window, document, console,
      require(name) { if (name === 'react') return { __esModule: true, default: React, ...React }; if (name === './Nokia1280') return nokia.exports; if (name === '../lib/api') return { recordPlay: async () => ({ success: true }) }; if (name === '../constants/keyMapping') return { DEFAULT_KEY_MAPPINGS: [] }; if (name === '../lib/touchKeypad') return { bindTouchKeypad() { throw new Error('Native touch has a separate DOM fixture'); } }; if (name.endsWith('.css')) return {}; throw new Error(name); } });
    const tree = module.exports.default({ gameId: 'fixture', jarUrl: '/fixture.jar' });
    function find(node, test) { if (!node || typeof node !== 'object') return null; if (test(node)) return node; for (const child of [node.props?.children].flat(Infinity)) { const found = find(child, test); if (found) return found; } return null; }
    const audioOrder = [];
    const iframe = { contentWindow: {
      unlockGameAudio: () => audioOrder.push('unlock'),
      postMessage: data => { audioOrder.push(data.pressed ? 'down' : 'up'); messages.push(data); },
    } };
    find(tree, node => node.type === 'iframe').props.ref.current = iframe;
    effects.forEach(effect => effect());
    const five = find(tree, node => node.props?.['aria-label'] === 'Phím 5').props;
    const up = find(tree, node => node.props?.['aria-label'] === 'Lên').props;
    const captured = []; const event = id => ({ pointerId: id, pointerType: 'touch', preventDefault() {}, currentTarget: { setPointerCapture: id => captured.push(id) } });
    five.onPointerDown(event(1)); up.onPointerDown(event(2)); five.onPointerDown(event(3));
    assert.deepEqual(audioOrder.slice(0, 2), ['unlock', 'down'], 'unlock audio synchronously before posting the key');
    document.activeElement = iframe; window.emit('blur');
    assert.equal(messages.length, 2, 'canvas refocus must not release held phone keys');
    five.onPointerUp(event(1)); assert.equal(messages.length, 2, 'second finger still holds 5');
    five.onPointerCancel(event(3)); five.onLostPointerCapture(event(3));
    document.hidden = true; document.emit('visibilitychange');
    assert.deepEqual(captured, [1,2,3]);
    assert.deepEqual(messages.map(({ code, pressed }) => [code, pressed]), [['Digit5',true],['ArrowUp',true],['Digit5',false],['ArrowUp',false]]);
  });
  await test('native iOS touch contacts prevent focus defaults and preserve multi-touch key lifetimes', () => {
    const doc = eventTarget();
    const five = { dataset: { emulatorKey: 'Digit5' }, disabled: false };
    const up = { dataset: { emulatorKey: 'ArrowUp' }, disabled: false };
    five.closest = () => five; up.closest = () => up;
    const root = eventTarget({ ownerDocument: doc, contains: button => button === five || button === up });
    const calls = [];
    const binding = bindTouchKeypad(root, (code, pressed) => calls.push([code, pressed]));
    let prevented = 0;
    const event = touches => ({ changedTouches: touches, cancelable: true, preventDefault() { prevented++; } });
    root.emit('touchstart', event([{ identifier: 10, target: five }, { identifier: 11, target: up }]));
    root.emit('touchstart', event([{ identifier: 12, target: five }]));
    assert.equal(binding.hasActiveTouches(), true);
    doc.emit('touchend', event([{ identifier: 10, target: five }]));
    assert.equal(calls.length, 2, 'a second finger continues holding the same phone key');
    doc.emit('touchcancel', event([{ identifier: 12, target: five }]));
    assert.deepEqual(calls, [['Digit5',true],['ArrowUp',true],['Digit5',false]]);
    doc.emit('touchcancel', event([]));
    assert.deepEqual(calls.at(-1), ['ArrowUp',false]);
    assert.equal(binding.hasActiveTouches(), false);
    assert.ok(prevented >= 3, 'native touch listener cancels browser focus/gesture defaults');
    binding.destroy();
    assert.equal(calls.length, 4, 'cleanup does not send duplicate releases');
  });
  await test('suspended/interrupted audio resumes in the synchronous gesture and rejected resumes remain retryable', async () => {
    for (const initial of ['suspended', 'interrupted']) {
      let calls = 0;
      const audio = { state: initial, resume() { calls++; this.state = 'running'; return Promise.resolve(); } };
      const result = resumeAudioContext(audio);
      assert.equal(calls, 1, 'resume must run before returning to the event loop');
      assert.equal(await result, true);
      assert.equal(await resumeAudioContext(audio), true);
      assert.equal(calls, 1, 'running audio does not need another resume');
    }
    let attempts = 0;
    const refused = { state: 'suspended', resume() { attempts++; return Promise.reject(new Error('gesture required')); } };
    assert.equal(await resumeAudioContext(refused), false);
    assert.equal(await resumeAudioContext(refused), false);
    assert.equal(attempts, 2);
  });
  for (const file of ['main.js', 'key.js', 'eventqueue.js', 'pointer.js']) assert.equal(read(`apps/emulator-web/src/${file}`), read(`apps/web/public/emulator/src/${file}`), `${file} served copy must match source`);
  assert.equal(read('apps/emulator-web/libmidi/libmidi.js'), read('apps/web/public/emulator/libmidi/libmidi.js'), 'audio helper served copy must match source');
  console.log(`${passed}/${passed} emulator input checks passed; source/served files match.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
