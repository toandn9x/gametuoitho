// Real WebKit engine with iPhone device settings; not a physical iPhone.
// PLAYWRIGHT_MODULE_PATH may point to an existing Playwright install.
// WEBKIT_EXECUTABLE_PATH may point to an existing compatible WebKit executable.
// node tests/pm/ios-webkit-input-review.cjs --url PUBLIC_GAME_PAGE
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { webkit, devices } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const args = process.argv.slice(2);
const fixture = args.length === 3 && args[2] === '--fixture';
assert.ok((args.length === 2 || fixture) && args[0] === '--url', 'Use --url PUBLIC_GAME_PAGE [--fixture]');
const url = new URL(args[1]);
assert.ok(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password);
async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gametuoitho-ios-webkit-'));
  const results = { target: url.href, checks: [], errors: [], consoleErrors: [], audioFallback: false, blockedMutations: [] };
  const browser = await webkit.launch({ headless: true, ...(process.env.WEBKIT_EXECUTABLE_PATH ? { executablePath: process.env.WEBKIT_EXECUTABLE_PATH } : {}) });
  let page, gameFrame, failure;
  const check = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); console.log(`[ios-webkit] ${pass ? 'PASS' : 'FAIL'} ${name}`); };
  try {
    results.engine = browser.version();
    results.scope = fixture
      ? 'Real WebKit, iPhone settings, actual built player + actual emulator JS input handler. The Java event consumer and game canvas are a fixture; no JVM/JAR execution. Not a physical iPhone/iOS 27 test.'
      : 'Desktop WebKit with iPhone device settings. Windows WebKit lacks WebAudio; a silent context is supplied only when AudioContext is missing. Sound is disabled in the game. Not a physical iPhone/iOS 27 test.';
    const context = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
    if (fixture) {
      const root = path.resolve(__dirname, '../..');
      await context.route('**/emulator/libmidi/libmidi.js', route => route.fulfill({
        status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(root, 'apps/emulator-web/libmidi/libmidi.js'), 'utf8'),
      }));
      const ts = require(path.join(root, 'node_modules/typescript'));
      const source = ts.createSourceFile('main.js', fs.readFileSync(path.join(root, 'apps/emulator-web/src/main.js'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const handler = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'setListeners');
      const audioUnlock = source.statements.find(node => ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression) && node.expression.left.getText(source) === 'window.unlockGameAudio');
      assert.ok(handler);
      assert.ok(audioUnlock);
      const body = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ninja input fixture</title>
        <style>body{margin:0;background:#101820}canvas{display:block;width:100%;height:100%}</style><canvas id="display" width="240" height="320" tabindex="0"></canvas><div id="loading" hidden></div>
        <script type="module">
        import {codeMap,keySymbol,KeyRepeatManager} from '/emulator/src/key.js';
        import {EventQueue} from '/emulator/src/eventqueue.js';
        import {KeyMapper} from '/emulator/src/keyMapper.js';
        import {bindCanvasPointerEvents} from '/emulator/src/pointer.js';
        import {resumeAudioContext} from '/emulator/libmidi/libmidi.js';
        const evtQueue=window.evtQueue=new EventQueue(),keyMapper=new KeyMapper(),keyRepeatManager=new KeyRepeatManager();
        const display=document.querySelector('canvas'),screenCtx=display.getContext('2d');let scaleSet=true,fractionScale=true,pendingJarBytes,resolveJarBytes;
        function setKbdHandler(){} function initKbdListeners(){} function autoscale(){}
        window.__audioGestureCalls=[];
        window.libmidi={context:{state:'suspended',resume(){const trusted=!!parent.__iosGestureActive;window.__audioGestureCalls.push({inGesture:trusted});if(trusted)this.state='running';return Promise.resolve();}}};
        ${ts.createPrinter().printNode(ts.EmitHint.Unspecified, audioUnlock, source)}
        ${ts.createPrinter().printNode(ts.EmitHint.Unspecified, handler, source)}
        setListeners();let count=0;function draw(){screenCtx.fillStyle=count%2?'#103d32':'#182a50';screenCtx.fillRect(0,0,240,320);screenCtx.fillStyle='white';screenCtx.font='12px sans-serif';screenCtx.fillText('WebKit input fixture',12,140);screenCtx.fillText('No JVM / game execution',12,160);}draw();
        (async()=>{while(true){const event=await evtQueue.waitForEvent();count++;draw();}})();
        </script>`;
      await context.route('**/emulator/run**', route => /^\/emulator\/run(?:\.html)?$/.test(new URL(route.request().url()).pathname)
        ? route.fulfill({ status: 200, contentType: 'text/html', body }) : route.continue());
    }
    await context.route('**/api/**', route => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
      results.blockedMutations.push({ method: route.request().method(), path: new URL(route.request().url()).pathname });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{}}' });
    });
    await context.addInitScript(() => {
      window.__iosEvents = [];
      // Keep a marker only while native event propagation is in progress.
      // A queued postMessage runs after the bubbling listener has cleared it.
      for (const type of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup']) {
        window.addEventListener(type, () => { window.__iosGestureActive = true; }, true);
        window.addEventListener(type, () => { window.__iosGestureActive = false; });
      }
      for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'touchcancel', 'focus', 'blur']) window.addEventListener(type, event => {
        window.__iosEvents.push({ type, pointerType: event.pointerType, target: event.target?.tagName, active: document.activeElement?.tagName, at: performance.now() });
      }, true);
      if (typeof AudioContext === 'undefined') {
        window.__silentTestAudio = true;
        window.AudioContext = class { state = 'running'; destination = {}; sampleRate = 44100; resume() { return Promise.resolve(); } close() { return Promise.resolve(); } };
      }
    });
    page = await context.newPage();
    page.on('pageerror', error => results.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') results.consoleErrors.push(message.text().slice(0, 2000)); });
    await page.goto(url.href);
    console.log(`[ios-webkit] WebKit ${results.engine}; waiting for actual game on ${url.href}`);
    await page.waitForFunction(() => {
      const frame = document.querySelector('iframe');
      return frame?.contentWindow?.evtQueue?.started && frame.contentDocument?.querySelector('#loading')?.hidden &&
        frame.contentDocument.title.toLowerCase().includes('ninja');
    }, {}, { timeout: 90000 });
    await page.waitForTimeout(1500);
    gameFrame = page.frames().find(frame => /\/emulator\/run(?:\.html)?(?:\?|$)/.test(frame.url()));
    assert.ok(gameFrame);
    results.audioFallback = await gameFrame.evaluate(() => !!window.__silentTestAudio);
    await gameFrame.evaluate(() => {
      window.__input = { messages: [], queued: [], consumed: [] };
      const queue = window.evtQueue, add = queue.queueEvent, poll = queue.waitForEvent;
      queue.queueEvent = function(event, ...args) { if (event.kind.startsWith('key')) __input.queued.push({ ...event, at: performance.now() }); return add.call(this, event, ...args); };
      queue.waitForEvent = function(...args) { const result = poll.apply(this, args); result.then(event => { if (event?.kind.startsWith('key')) __input.consumed.push({ ...event, at: performance.now() }); }); return result; };
      window.addEventListener('message', event => { if (event.source === parent && event.origin === location.origin && event.data?.type === 'KEY_EVENT') __input.messages.push({ code: event.data.code, pressed: event.data.pressed }); });
    });
    const input = () => gameFrame.evaluate(() => window.__input);
    const hash = () => gameFrame.evaluate(() => {
      const canvas = document.querySelector('#display'), pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let value = 0; for (let i = 0; i < pixels.length; i += 52) value = (value * 31 + pixels[i] + pixels[i + 1] * 7 + pixels[i + 2] * 13) >>> 0;
      return value;
    });
    const tap = async selector => { await page.locator(selector).tap({ timeout: 5000 }); await page.waitForTimeout(350); };
    check(fixture ? 'actual emulator JS input handler polls in WebKit fixture' : 'actual game starts and polls input in WebKit', true);
    await page.screenshot({ path: path.join(output, '1-before.png') });
    if (fixture) check('child audio starts suspended in the gesture regression fixture', await gameFrame.evaluate(() => window.libmidi.context.state === 'suspended'));
    const before = await hash();
    // Right soft key chooses sound off, so Windows WebKit can run the real JAR silently.
    await tap('.nokia1280__sidekeys:last-child button:first-child');
    await page.waitForTimeout(700);
    const first = await input();
    check(fixture ? 'trusted WebKit touch sends soft-key press/release' : 'trusted WebKit touch changes the game screen', fixture
      ? first.messages.some(e => e.code === 'F2' && e.pressed) && first.messages.some(e => e.code === 'F2' && !e.pressed)
      : before !== await hash());
    if (fixture) {
      const audio = await gameFrame.evaluate(() => ({ state: window.libmidi.context.state, calls: window.__audioGestureCalls }));
      check('Nokia touch resumes child audio inside the original gesture', audio.state === 'running' && audio.calls.some(call => call.inGesture), audio);
    }
    await tap('.nokia1280__sidekeys:first-child button:first-child');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(output, '2-after-setup.png') });
    for (const [code, keyCode, selector] of [
      ['F1',112,'.nokia1280__sidekeys:first-child button:first-child'],
      ['F2',113,'.nokia1280__sidekeys:last-child button:first-child'],
      ['Enter',13,'.nokia1280__select'],
      ['ArrowUp',38,'.nokia1280__direction--up'],
      ['ArrowDown',40,'.nokia1280__direction--down'],
      ['ArrowLeft',37,'.nokia1280__direction--left'],
      ['ArrowRight',39,'.nokia1280__direction--right'],
      ['Digit5',53,'.nokia1280__numbers button:nth-child(5)'],
    ]) {
      const previous = await input(); await tap(selector); const current = await input();
      const messages = current.messages.slice(previous.messages.length), consumed = current.consumed.slice(previous.consumed.length);
      check(`${code}: trusted touch sends press/release to iframe`, messages.some(e => e.code === code && e.pressed) && messages.some(e => e.code === code && !e.pressed));
      check(`${code}: touch and pointer do not duplicate key events`, messages.filter(e => e.code === code && e.pressed).length === 1 && messages.filter(e => e.code === code && !e.pressed).length === 1);
      check(`${code}: ${fixture ? 'emulator queue consumer' : 'Java'} polls press/release`, consumed.some(e => e.kind === 'keydown' && e.args[0] === keyCode) && consumed.some(e => e.kind === 'keyup' && e.args[0] === keyCode));
    }
    if (fixture) {
      const previous = await input();
      // Deterministic regression for iOS's transient BODY focus/blur between
      // touchstart and touchend. This lifecycle check uses synthetic events.
      await page.evaluate(() => {
        const button = document.querySelector('.nokia1280__select');
        const event = new Event('touchstart', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'changedTouches', { value: [{ identifier: 987, target: button }] });
        button.dispatchEvent(event);
        document.body.setAttribute('tabindex', '-1'); document.body.focus();
        window.dispatchEvent(new Event('blur'));
      });
      await page.waitForTimeout(60);
      const held = (await input()).messages.slice(previous.messages.length);
      check('focus hand-off does not release a live touch contact', held.length === 1 && held[0].code === 'Enter' && held[0].pressed);
      await page.evaluate(() => {
        const button = document.querySelector('.nokia1280__select');
        const event = new Event('touchend', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'changedTouches', { value: [{ identifier: 987, target: button }] });
        button.dispatchEvent(event);
      });
      await page.waitForTimeout(100);
      const ended = (await input()).messages.slice(previous.messages.length);
      check('touchend after focus hand-off releases the key once', ended.length === 2 && !ended[1].pressed);
    }
    results.input = await input();
    results.parentEvents = await page.evaluate(() => window.__iosEvents);
    check('no uncaught WebKit exceptions', results.errors.length === 0, results.errors);
    await page.screenshot({ path: path.join(output, '3-after-keys.png') });
  } catch (error) {
    failure = error; results.failure = error.message; console.log(`[ios-webkit] FAILED ${error.message}`);
    if (page) {
      await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
      results.frames = await Promise.all(page.frames().map(frame => frame.evaluate(() => ({ url: location.href, title: document.title, loading: document.querySelector('#loading')?.textContent, ready: window.evtQueue?.started })).catch(() => null)));
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log(`[ios-webkit] ${results.checks.filter(c => c.pass).length}/${results.checks.length} checks passed. Evidence: ${output}`);
  }
  if (failure || results.checks.some(c => !c.pass)) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
