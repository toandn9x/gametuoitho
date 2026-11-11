// Run after pnpm cf:build. PLAYWRIGHT_MODULE_PATH can use an existing Playwright install;
// CHROME_PATH and WEBKIT_EXECUTABLE_PATH can select installed browser executables.
// Real built React UI, emulator HTML/CSS, input and scaling modules; a canvas/game-state
// fixture replaces CheerpJ. No JVM/JAR execution, external requests or real database writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const root = path.resolve(__dirname, '../..');
const ts = require(path.join(root, 'node_modules/typescript'));
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const dist = path.join(root, 'apps/web/dist');
const results = [];

function emulatorFixture(delay) {
  const source = ts.createSourceFile('main.js', read('apps/web/public/emulator/src/main.js'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const functions = ['autoscale', 'setListeners'].map(name => source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(source)).join('\n');
  const preference = source.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(source) === 'fractionScale')).getText(source);
  const script = `
    import {codeMap,keySymbol,KeyRepeatManager} from '/emulator/src/key.js';
    import {EventQueue} from '/emulator/src/eventqueue.js';
    import {KeyMapper} from '/emulator/src/keyMapper.js';
    import {bindCanvasPointerEvents} from '/emulator/src/pointer.js';
    import {initKbdListeners,setKbdHandler,kbdWidth,kbdHeight} from '/emulator/src/screenKbd.js';
    const sp=new URLSearchParams(location.search),evtQueue=new EventQueue(),keyMapper=new KeyMapper(),keyRepeatManager=new KeyRepeatManager();
    const display=document.querySelector('#display'),screenCtx=display.getContext('2d');
    let isMobile=sp.get('mobile'),scaleSet=true,pendingJarBytes=null;
    ${preference}
    const probe=window.sessionProbe={token:crypto.randomUUID(),score:0,ticks:0,events:[],bytesLoads:0,running:false};
    let resolveJarBytes=bytes=>{probe.bytesLoads++;probe.byteLength=bytes.byteLength;probe.running=true;};
    window.unlockGameAudio=()=>{};
    ${functions}
    display.width=240;display.height=320;display.style.display='';document.querySelector('#loading').hidden=true;
    screenCtx.fillStyle='#193345';screenCtx.fillRect(0,0,240,320);
    screenCtx.fillStyle='#ef4444';screenCtx.fillRect(0,0,240,12);
    screenCtx.fillStyle='#22d3ee';screenCtx.fillRect(0,308,240,12);
    setInterval(()=>{if(probe.running)probe.ticks++;},20);
    await new Promise(resolve=>setTimeout(resolve,${delay}));
    setListeners();autoscale();evtQueue.started=true;parent.postMessage({type:'EMULATOR_STARTED'},location.origin);
    (async()=>{while(true)probe.events.push(await evtQueue.waitForEvent());})();
    if(sp.get('mode')==='direct')parent.postMessage({type:'EMULATOR_READY'},location.origin);
    else {probe.byteLength=(await(await fetch(sp.get('jar'))).arrayBuffer()).byteLength;probe.running=true;}
  `;
  return read('apps/web/public/emulator/run.html')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace('</body>', `<script type="module">${script}</script></body>`);
}

async function main() {
  assert.ok(fs.existsSync(path.join(dist, 'play/_shell/index.html')), 'Run pnpm cf:build first');
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gametuoitho-session-review-'));
  const requests = [];
  let startupDelay = 0;
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    requests.push({ method: req.method, pathname });
    res.setHeader('Cache-Control', 'no-store');
    const json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ success: true, data })); };
    if (pathname === '/api/v1/games/session-fixture') return json({ game: { id: 'session-fixture', name: 'Session fixture', slug: 'session-fixture' }, versions: [{ id: 'fixture-version', jar_url: '/api/v1/assets/raw/fixture.jar' }], screenshots: [] });
    if (pathname === '/api/v1/auth/me') return json({ id: 'fixture-user', username: 'fixture', role: 'USER' });
    if (pathname === '/api/v1/me/imports') return json([{ id: 'fixture-import', custom_name: 'Private session fixture', jar_url: '/api/v1/assets/raw/fixture.jar' }]);
    if (pathname === '/api/v1/assets/raw/fixture.jar') { res.setHeader('Content-Type', 'application/java-archive'); return res.end(Buffer.from([80, 75, 3, 4])); }
    if (pathname.startsWith('/api/')) return json({});
    if (pathname === '/emulator/run.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(emulatorFixture(startupDelay)); }
    const assetPath = pathname === '/play/custom' ? '/play/custom/index.html' : pathname.startsWith('/play/') ? '/play/_shell/index.html' : decodeURIComponent(pathname);
    const file = path.resolve(dist, '.' + assetPath);
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    for (const engine of ['chromium', 'webkit']) {
      browser = engine === 'chromium'
        ? await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
        : await webkit.launch({ headless: true, ...(process.env.WEBKIT_EXECUTABLE_PATH ? { executablePath: process.env.WEBKIT_EXECUTABLE_PATH } : {}) });
      for (const scenario of [
        { width: 667, height: 375, direct: false }, { width: 568, height: 320, direct: false },
        { width: 1280, height: 900, direct: false }, { width: 390, height: 844, direct: false },
        { width: 844, height: 390, direct: false },
        { width: 1280, height: 900, direct: true }, { width: 390, height: 844, direct: true },
        { width: 1280, height: 900, direct: true, delayed: true },
      ]) {
        startupDelay = scenario.delayed ? 1500 : 0;
        const requestStart = requests.length;
        const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height }, hasTouch: scenario.width < 768 || scenario.height < 500, serviceWorkers: 'block' });
        await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
        await context.addInitScript(() => localStorage.setItem('gametuoitho_token', 'local-session-test-only'));
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin + (scenario.direct ? '/play/custom?importId=fixture-import' : '/play/session-fixture'));
        await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow?.sessionProbe);
        await page.evaluate(() => { window.savedFrame = document.querySelector('iframe'); window.savedDocument = savedFrame.contentDocument; });
        const choose = label => page.getByRole('button').filter({ hasText: label }).click();
        if (scenario.delayed) await choose('Arcade');
        await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow?.sessionProbe.running);
        if (scenario.delayed) await page.waitForFunction(() => !document.querySelector('iframe').contentDocument.documentElement.dataset.skin);
        await page.evaluate(() => { const probe = savedFrame.contentWindow.sessionProbe; probe.score = 987; window.savedToken = probe.token; window.savedSrc = savedFrame.src; window.savedTicks = probe.ticks; });
        if (scenario.delayed) await choose('Nokia 1280');
        // A mouse contact still held while switching must receive its release.
        await page.locator('[data-emulator-key="ArrowRight"]:visible').dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'mouse', button: 0 });
        for (const [label, skin] of [['Arcade', 'default'], ['Chia đôi', 'default'], ['Màn hình rộng', 'default'], ['Nokia 1280', 'nokia1280'], ['Màn hình rộng', 'default'], ['Chia đôi', 'default'], ['Arcade', 'default'], ['Nokia 1280', 'nokia1280']]) {
          await choose(label);
          await page.waitForFunction(skin => (document.querySelector('iframe').contentDocument.documentElement.dataset.skin || 'default') === skin, skin);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const state = await page.evaluate(() => {
            const frame = document.querySelector('iframe'), canvas = frame.contentDocument.querySelector('canvas'), rect = canvas.getBoundingClientRect(), probe = frame.contentWindow.sessionProbe;
            return { sameElement: frame === savedFrame, sameDocument: frame.contentDocument === savedDocument, sameSrc: frame.src === savedSrc, sameToken: probe.token === savedToken, score: probe.score, ticks: probe.ticks, bytesLoads: probe.bytesLoads,
              fits: rect.left >= -.6 && rect.top >= -.6 && rect.right <= frame.contentWindow.innerWidth + .6 && rect.bottom <= frame.contentWindow.innerHeight + .6 };
          });
          assert.ok(state.sameElement && state.sameDocument && state.sameSrc && state.sameToken && state.score === 987 && state.fits, JSON.stringify({ engine, scenario, label, state }));
        }
        await page.waitForFunction(() => savedFrame.contentWindow.sessionProbe.ticks > savedTicks && savedFrame.contentWindow.sessionProbe.events.some(event => event.kind === 'keyup' && event.args[0] === 39));
        await page.locator('[data-emulator-key="Digit5"]:visible').click({ delay: 100 });
        await page.waitForFunction(() => savedFrame.contentWindow.sessionProbe.events.some(event => event.kind === 'keyup' && event.args[0] === 53));
        await choose('Chia đôi');
        await page.locator('.split-player').scrollIntoViewIfNeeded();
        const left = page.locator('.split-player__left [data-emulator-key="ArrowRight"]');
        const action = page.locator('.split-player__right [data-emulator-key="Digit5"]');
        const leftBox = await left.boundingBox(), actionBox = await action.boundingBox();
        assert.ok(leftBox.x < actionBox.x, 'D-pad is to the left of action buttons');
        if (scenario.width >= 560 && scenario.height <= 500) {
          const screenBox = await page.locator('.split-player__screen').boundingBox();
          assert.ok(leftBox.x + leftBox.width <= screenBox.x && screenBox.x + screenBox.width <= actionBox.x,
            'short landscape screens keep D-pad, game screen and actions in one row');
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal page overflow');
        let eventStart = await page.evaluate(() => savedFrame.contentWindow.sessionProbe.events.length);
        if (engine === 'chromium') {
          const cdp = await context.newCDPSession(page);
          await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [
            { x: leftBox.x + leftBox.width / 2, y: leftBox.y + leftBox.height / 2, id: 1 },
            { x: actionBox.x + actionBox.width / 2, y: actionBox.y + actionBox.height / 2, id: 2 },
          ] });
          await page.waitForTimeout(120);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await cdp.detach();
        } else {
          // WebKit touch contexts use trusted taps; two contacts use a DOM fixture.
          if (scenario.width < 768 || scenario.height < 500) await action.tap(); else await action.click();
          await page.evaluate(() => {
            const root = document.querySelector('.split-player');
            const contacts = [root.querySelector('.split-player__left [data-emulator-key="ArrowRight"]'), root.querySelector('.split-player__right [data-emulator-key="Digit5"]')].map((target, identifier) => ({ target, identifier }));
            for (const type of ['touchstart', 'touchend']) { const event = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(event, 'changedTouches', { value: contacts }); root.dispatchEvent(event); }
          });
        }
        await page.waitForFunction(start => {
          const events = savedFrame.contentWindow.sessionProbe.events.slice(start);
          return [39, 53].every(code => ['keydown', 'keyup'].every(kind => events.some(event => event.kind === kind && event.args[0] === code)));
        }, eventStart);
        await page.screenshot({ path: path.join(output, `${engine}-${scenario.width}-${scenario.direct ? 'private' : 'catalog'}-split.png`) });
        await page.getByRole('button', { name: 'Cài đặt phím và FPS', exact: true }).click();
        await page.getByRole('button', { name: 'Thêm phím cho Phím 5', exact: true }).click();
        await page.keyboard.press('z');
        await page.getByRole('button', { name: 'Bỏ phím Z khỏi Phím 5', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Đóng cài đặt', exact: true }).click();
        const gameFrame = page.frames().find(frame => frame !== page.mainFrame());
        eventStart = await page.evaluate(() => savedFrame.contentWindow.sessionProbe.events.length);
        await gameFrame.locator('#display').focus(); await page.keyboard.press('z');
        await page.waitForFunction(start => savedFrame.contentWindow.sessionProbe.events.slice(start).some(event => event.kind === 'keydown' && event.args[0] === 53 && event.args[1] === 53), eventStart);
        await page.getByRole('button', { name: 'Cài đặt phím và FPS', exact: true }).click();
        await page.getByRole('button', { name: 'Bỏ phím Z khỏi Phím 5', exact: true }).waitFor();
        await page.screenshot({ path: path.join(output, `${engine}-${scenario.width}-settings.png`) });
        eventStart = await page.evaluate(() => savedFrame.contentWindow.sessionProbe.events.length);
        await page.getByRole('button', { name: 'Mở cài đặt FPS', exact: true }).click();
        await page.getByRole('group', { name: 'Điều khiển cài đặt FPS', exact: true }).waitFor();
        await page.waitForFunction(start => savedFrame.contentWindow.sessionProbe.events.slice(start).some(event => event.kind === 'keyup' && event.args[0] === 27), eventStart);
        eventStart = await page.evaluate(() => savedFrame.contentWindow.sessionProbe.events.length);
        await page.getByRole('button', { name: '↓ Xuống', exact: true }).evaluate(button => {
          for (let i = 0; i < 10; i++) button.click();
        });
        await page.waitForTimeout(150);
        const menuPresses = await page.evaluate(start => savedFrame.contentWindow.sessionProbe.events.slice(start)
          .filter(event => event.kind === 'keydown' && event.args[0] === 40).length, eventStart);
        assert.equal(menuPresses, 10, 'rapid FPS menu taps must each deliver a separate press');
        await page.getByRole('button', { name: 'Ẩn hướng dẫn FPS', exact: true }).click();
        assert.ok(await page.evaluate(() => savedFrame === document.querySelector('iframe') && savedFrame.contentDocument === savedDocument && savedFrame.contentWindow.sessionProbe.score === 987), 'settings keep the game session alive');
        const playedRequests = requests.slice(requestStart);
        assert.equal(playedRequests.filter(req => req.pathname === '/emulator/run.html').length, 1, 'no emulator reload when changing skins');
        assert.equal(playedRequests.filter(req => req.pathname === '/api/v1/assets/raw/fixture.jar').length, 1, 'game binary downloaded once');
        assert.equal(playedRequests.filter(req => req.pathname === '/api/v1/me/history' && req.method === 'POST').length, 1, 'one play history record');
        assert.equal(await page.evaluate(() => savedFrame.contentWindow.sessionProbe.bytesLoads), scenario.direct ? 1 : 0, 'private bytes loaded once');
        // Explicit retry must still create a fresh game session.
        await page.frames().find(frame => frame !== page.mainFrame()).evaluate(() => parent.postMessage({ type: 'EMULATOR_ERROR', errorType: 'CRASH', message: 'Session retry fixture' }, location.origin));
        await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
        await page.waitForFunction(() => { const frame = document.querySelector('iframe'); return frame.contentDocument !== savedDocument && frame.contentWindow.sessionProbe?.running; });
        assert.equal(await page.evaluate(() => document.querySelector('iframe').contentWindow.sessionProbe.score), 0);
        await page.getByRole('button', { name: 'Cài đặt phím và FPS', exact: true }).click();
        await page.getByRole('button', { name: 'Bỏ phím Z khỏi Phím 5', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Bỏ phím Z khỏi Phím 5', exact: true }).click();
        await page.getByRole('button', { name: 'Bỏ phím Z khỏi Phím 5', exact: true }).waitFor({ state: 'detached' });
        await page.getByRole('button', { name: 'Khôi phục phím mặc định', exact: true }).click();
        await page.getByRole('button', { name: 'Đóng cài đặt', exact: true }).click();
        assert.deepEqual(errors, []);
        results.push({ engine, ...scenario, switches: 8, sameSession: true, splitMultiTouch: true, keyMappingPersists: true, fpsShortcut: true, retryStartsNewSession: true });
        console.log(`PASS ${engine} ${scenario.width}px ${scenario.direct ? 'private bytes' : 'catalog URL'}${scenario.delayed ? ' delayed startup' : ''}: four layouts preserve session; split multi-touch, remapping persistence, FPS shortcut and retry work`);
        await context.close();
      }
      await browser.close(); browser = null;
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, scope: 'Built player and real emulator input/scale with canvas/game-state fixture; no JVM or physical iPhone.' }, null, 2));
    console.log(`${results.length} session scenarios passed. Evidence: ${output}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
