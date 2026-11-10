// Node 22 + installed Chrome only. Never runs Java/JAR on the server.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const options = { url: 'http://127.0.0.1:4321/play/thachsanh', 'wait-ms': '90000' };
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index].replace(/^--/, '');
  if (!['url', 'wait-ms', 'output-dir', 'keys', 'key-delay-ms', 'viewport', 'tap-key', 'tap-screen', 'input-mode'].includes(key) || !process.argv[index + 1]) throw new Error('Usage: node scripts/diagnose-player.cjs [--url URL] [--wait-ms 90000] [--output-dir PATH] [--keys Enter,ArrowDown] [--key-delay-ms 800] [--viewport 390x844] [--tap-key Enter] [--tap-screen X,Y] [--input-mode mouse|touch]');
  options[key] = process.argv[index + 1];
}
const waitMs = Number(options['wait-ms']);
const keys = options.keys ? options.keys.split(',') : [];
const keyDelayMs = Number(options['key-delay-ms'] || 800);
const touchInput = options['input-mode'] === 'touch';
if (options['input-mode'] && !['mouse', 'touch'].includes(options['input-mode'])) throw new Error('--input-mode must be mouse or touch');
const screenTap = options['tap-screen']?.match(/^(\d{1,4}),(\d{1,4})$/);
if (options['tap-screen'] && !screenTap) throw new Error('--tap-screen must be X,Y in native game pixels');
if (!Number.isFinite(keyDelayMs) || keyDelayMs < 0 || keyDelayMs > 3000) throw new Error('--key-delay-ms must be between 0 and 3000');
const viewport = /^(\d{3,4})x(\d{3,4})$/.exec(options.viewport || '1280x1000');
if (!viewport || +viewport[1] < 320 || +viewport[1] > 1920 || +viewport[2] < 480 || +viewport[2] > 1600) throw new Error('--viewport must be WIDTHxHEIGHT, width 320–1920, height 480–1600');
const tapSelectors = { Enter: '.nokia1280__select', F1: '.nokia1280__sidekeys:first-child button:first-child', F2: '.nokia1280__sidekeys:last-child button:first-child', '5': '.nokia1280__numbers button:nth-child(5)' };
const tapKeys = options['tap-key'] ? options['tap-key'].split(',') : [];
if (tapKeys.length > 12 || tapKeys.some(key => !Object.hasOwn(tapSelectors, key))) throw new Error('--tap-key supports up to 12 comma-separated keys: Enter,F1,F2,5');
const keyCodes = { Enter: 13, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, F1: 112, F2: 113, Escape: 27, '2': 50, '4': 52, '5': 53, '6': 54, '8': 56 };
if (keys.length > 12 || keys.some(key => !Object.hasOwn(keyCodes, key))) throw new Error('Use at most 12 keys from Enter,ArrowUp,ArrowDown,ArrowLeft,ArrowRight,F1,F2,Escape,2,4,5,6,8');
if (!Number.isFinite(waitMs) || waitMs < 0 || waitMs > 90000) throw new Error('--wait-ms must be between 0 and 90000');
const targetUrl = new URL(options.url);
if (!['http:', 'https:'].includes(targetUrl.protocol) || targetUrl.username || targetUrl.password) throw new Error('Use an HTTP(S) URL without embedded credentials');

function redact(value) {
  return String(value)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
    .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:[?&]|\b)(?:access_token|refresh_token|token|jwt|api_key|apikey|password|secret|authorization|cookie)\s*[=:]\s*)[^\s&"'<>]+/gi, '$1[REDACTED]');
}

class CDP {
  constructor(url, onEvent) {
    this.socket = new WebSocket(url);
    this.pending = new Map();
    this.nextId = 0;
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket open timeout')), 5000);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP WebSocket could not open')); }, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        message.error ? pending.reject(new Error(`${pending.method}: ${message.error.message}`)) : pending.resolve(message.result);
      } else {
        Promise.resolve(onEvent(message)).catch(() => {});
      }
    });
    this.socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Own browser CDP closed')); }
      this.pending.clear();
    });
  }
  async send(method, params = {}, sessionId) {
    await this.ready;
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error('Own browser CDP is not open');
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 5000);
      this.pending.set(id, { resolve, reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

async function main() {
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (!fs.existsSync(chrome)) throw new Error(`Installed Chrome not found: ${chrome}`);
  const tempRoot = fs.realpathSync(os.tmpdir());
  const profile = fs.mkdtempSync(path.join(tempRoot, 'gametuoitho-player-profile-'));
  const outputDir = options['output-dir'] ? path.resolve(options['output-dir']) : fs.mkdtempSync(path.join(tempRoot, 'gametuoitho-player-diagnostic-'));
  fs.mkdirSync(outputDir, { recursive: true });
  const events = [];
  const contexts = new Map();
  const requests = new Map();
  let browser; let cdp; let fatal; let browserStderr = '';
  const started = Date.now();
  const log = (kind, details) => events.push({ elapsedMs: Date.now() - started, kind, ...details });
  const print = (message) => console.log(`[player-diagnostic] ${redact(message)}`);
  const remoteText = (argument) => redact(argument.value !== undefined ? (typeof argument.value === 'object' ? '[object omitted]' : argument.value) : argument.description || argument.type);
  const interesting = (url) => /\/api\/v1\/|cjrtnc\.leaningtech\.com|\/emulator\/.*(?:main\.js|run\.html|\.jar|\.wasm|libmidi|libmedia)/i.test(url);

  async function enable(sessionId) {
    await Promise.all([
      cdp.send('Runtime.enable', {}, sessionId), cdp.send('Log.enable', {}, sessionId),
      cdp.send('Network.enable', {}, sessionId),
    ]);
    await cdp.send('Network.setBypassServiceWorker', { bypass: true }, sessionId);
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
    await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
  }

  const hardStop = setTimeout(() => {
    fatal = fatal || new Error('Overall diagnostic limit reached (110 seconds)');
    browser?.kill();
    cdp?.socket.close();
  }, 110000);
  try {
    print(`Starting isolated hidden Chrome: ${redact(targetUrl.href)}`);
    browser = spawn(chrome, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--disable-background-networking', '--disable-component-update',
      '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${profile}`, 'about:blank',
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let spawnError;
    browser.once('error', (error) => { spawnError = error; });
    browser.stderr.on('data', (chunk) => { browserStderr = (browserStderr + redact(chunk)).slice(-6000); });
    const portFile = path.join(profile, 'DevToolsActivePort');
    while (!fs.existsSync(portFile)) {
      if (spawnError) throw spawnError;
      if (browser.exitCode !== null) throw new Error(`Own Chrome exited ${browser.exitCode}: ${browserStderr}`);
      if (Date.now() - started > 15000) throw new Error(`DevToolsActivePort was not created: ${browserStderr}`);
      await delay(100);
    }
    const port = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('Invalid own Chrome DevTools port');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
    const page = targets.find((target) => target.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('Own Chrome page target was not found');
    cdp = new CDP(page.webSocketDebuggerUrl, async ({ method, params = {}, sessionId = '' }) => {
      const contextKey = (id) => `${sessionId}:${id}`;
      if (method === 'Runtime.executionContextCreated') {
        contexts.set(contextKey(params.context.id), { id: params.context.id, sessionId, origin: redact(params.context.origin), frameId: params.context.auxData?.frameId });
      } else if (method === 'Runtime.executionContextDestroyed') contexts.delete(contextKey(params.executionContextId));
      else if (method === 'Runtime.executionContextsCleared') {
        for (const [key, value] of contexts) if (value.sessionId === sessionId) contexts.delete(key);
      } else if (method === 'Runtime.consoleAPICalled') {
        const text = params.args.map(remoteText).join(' ');
        log('console', { sessionId, contextId: params.executionContextId, level: params.type, text });
        if (params.type === 'error' || /Error Running Jar|Game crashed|Caused by:|\b\w*(?:Exception|Error)\b|^\s*at\s+[\w.$]+\(/i.test(text)) {
          print(`console ${params.type} [context ${params.executionContextId}]: ${text}`);
        }
      } else if (method === 'Runtime.exceptionThrown') {
        const detail = params.exceptionDetails;
        const text = redact(detail.exception?.description || detail.text);
        log('exception', { sessionId, contextId: detail.executionContextId, text, url: redact(detail.url || ''), line: detail.lineNumber });
        print(`browser exception [context ${detail.executionContextId}]: ${text}`);
      } else if (method === 'Log.entryAdded') {
        log('browser-log', { sessionId, level: params.entry.level, source: params.entry.source, text: redact(params.entry.text), url: redact(params.entry.url || '') });
      } else if (method === 'Network.requestWillBeSent') {
        requests.set(`${sessionId}:${params.requestId}`, redact(params.request.url));
      } else if (method === 'Network.responseReceived' && interesting(params.response.url)) {
        const response = params.response;
        log('response', { sessionId, url: redact(response.url), status: response.status, mimeType: response.mimeType, fromServiceWorker: !!response.fromServiceWorker, fromDiskCache: !!response.fromDiskCache });
      } else if (method === 'Network.loadingFailed') {
        log('network-failed', { sessionId, url: requests.get(`${sessionId}:${params.requestId}`) || '', error: redact(params.errorText), blockedReason: params.blockedReason, canceled: params.canceled });
      } else if (method === 'Target.attachedToTarget') {
        log('attached-target', { sessionId: params.sessionId, type: params.targetInfo.type, url: redact(params.targetInfo.url) });
        try { await enable(params.sessionId); }
        catch (error) { log('diagnostic-warning', { text: redact(error.message) }); }
        finally { await cdp.send('Runtime.runIfWaitingForDebugger', {}, params.sessionId).catch(() => {}); }
      }
    });
    await enable();
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: +viewport[1], height: +viewport[2], deviceScaleFactor: 1, mobile: touchInput });
    if (touchInput) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    log('browser-version', await cdp.send('Browser.getVersion'));
    await cdp.send('Page.navigate', { url: targetUrl.href });
    print('Navigated; collecting Java console, browser exceptions and network failures. Service worker bypass and HTTP cache disabled.');
    const until = Date.now() + waitMs;
    const expression = `(() => {
      if(typeof document==='undefined') return null;
      const loading=document.querySelector('#loading');
      return {url:location.href,title:document.title,loadingText:loading?.textContent?.trim().slice(0,1200)||null,loadingHidden:loading?.hidden??null,
        overflow:document.documentElement.scrollWidth>innerWidth,
        overflows:document.documentElement.scrollWidth>innerWidth?[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.right>innerWidth+1}).slice(0,8).map(e=>({tag:e.tagName,classes:e.getAttribute('class'),right:e.getBoundingClientRect().right})):[],
        phone:(()=>{const p=document.querySelector('.nokia1280'); if(!p)return null; const r=p.getBoundingClientRect(); return {width:r.width,height:r.height,left:r.left,right:r.right,buttons:p.querySelectorAll('button').length}})(),
        canvases:[...document.querySelectorAll('canvas')].map(canvas=>{
          const result={width:canvas.width,height:canvas.height,display:getComputedStyle(canvas).display,clientWidth:canvas.clientWidth,clientHeight:canvas.clientHeight};
          try {const rgba=canvas.getContext('2d')?.getImageData(0,0,canvas.width,canvas.height).data; if(rgba){const colours=new Set(); let hash=0; for(let i=0;i<rgba.length;i+=4*13){hash=(hash*31+rgba[i]+rgba[i+1]*7+rgba[i+2]*13)>>>0; colours.add((rgba[i]<<16)|(rgba[i+1]<<8)|rgba[i+2]);} result.hash=hash; result.colours=colours.size;}} catch{}
          return result;
        })};
    })()`;
    async function sample() {
      await Promise.all([...contexts.values()].map(async (context) => {
        try {
          const response = await cdp.send('Runtime.evaluate', { expression, contextId: context.id, returnByValue: true }, context.sessionId || undefined);
          if (response.result?.value) {
            const value = response.result.value;
            value.url = redact(value.url); value.title = redact(value.title); value.loadingText = value.loadingText ? redact(value.loadingText) : null;
            log('frame-state', { contextId: context.id, sessionId: context.sessionId, ...value });
          }
        } catch { /* Navigation destroys contexts; the next sample uses current contexts. */ }
      }));
      const frameStates = events.filter((item) => item.kind === 'frame-state').slice(-contexts.size);
      print(`${Math.round((Date.now() - started) / 1000)}s: ${events.filter((item) => item.kind === 'console').length} console lines; ${events.filter((item) => item.kind === 'exception').length} exceptions; ${events.filter((item) => item.kind === 'network-failed').length} failed requests; ${frameStates.map((item) => `${item.title}: ${item.loadingHidden ? 'canvas visible' : item.loadingText || 'no loader'}`).join(' | ').slice(0,500)}`);
    }
    await sample();
    let exercised = false;
    let tapped = false;
    while (!fatal && Date.now() < until) {
      await delay(Math.min(10000, until - Date.now()));
      await sample();
      if (!tapped && (options['tap-key'] || screenTap) && Date.now() < until) {
        tapped = true;
        await cdp.send('Runtime.evaluate', { expression: `(()=>{const w=document.querySelector('iframe')?.contentWindow,q=w?.evtQueue;if(!q)return;const original=q.queueEvent;q.queueEvent=function(event,...args){w.console.log('[Input]',JSON.stringify(event));return original.call(this,event,...args);};})()` });
        for (const [index, key] of [...tapKeys, ...(screenTap ? [null] : [])].entries()) {
          const selector = JSON.stringify(tapSelectors[key]);
          const expression = key === null
            ? `(()=>{const f=document.querySelector('iframe'),c=f?.contentDocument?.querySelector('#display');if(!c)return null; f.scrollIntoView({block:'center'});const a=f.getBoundingClientRect(),r=c.getBoundingClientRect(); return {x:a.left+r.left+${Number(screenTap?.[1])}*r.width/c.width,y:a.top+r.top+${Number(screenTap?.[2])}*r.height/c.height};})()`
            : `(()=>{const b=document.querySelector(${selector}); if(!b)return null; b.scrollIntoView({block:'center'}); const r=b.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};})()`;
          const position = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
          const point = position.result?.value;
          if (!point) throw new Error('Requested phone button/canvas was not found');
          const before = await cdp.send('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(outputDir, `player-before-input-${index}.png`), Buffer.from(before.data, 'base64'));
          if (touchInput) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
            await delay(120);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          } else {
            for (const type of ['mousePressed', 'mouseReleased']) {
              await cdp.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
              await delay(120);
            }
          }
          log('input-tap', { key, screen: key === null ? options['tap-screen'] : undefined, mode: touchInput ? 'touch' : 'mouse' });
          await delay(1000);
        }
        await cdp.send('Runtime.evaluate', { expression: "document.querySelector('.nokia1280')?.scrollIntoView({block:'start'})" });
      }
      if (!exercised && keys.length && Date.now() < until) {
        exercised = true;
        const before = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(outputDir, 'player-before-input.png'), Buffer.from(before.data, 'base64'));
        await cdp.send('Runtime.evaluate', { expression: `document.querySelector('iframe')?.contentDocument?.getElementById('display')?.focus()` });
        for (const key of keys) {
          const code = /^\d$/.test(key) ? 'Digit' + key : key;
          for (const type of ['keyDown', 'keyUp']) {
            await cdp.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCodes[key] });
            await delay(100);
          }
          log('input-key', { key });
          await delay(keyDelayMs);
        }
      }
    }
    if (fatal) throw fatal;
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(outputDir, 'player-final.png'), Buffer.from(screenshot.data, 'base64'));
  } catch (error) {
    fatal = error;
    log('diagnostic-error', { text: redact(error.message) });
  } finally {
    clearTimeout(hardStop);
    if (cdp) { await cdp.send('Browser.close').catch(() => {}); cdp.socket.close(); }
    if (browser && browser.exitCode === null && !browser.killed) {
      await Promise.race([new Promise((resolve) => browser.once('close', resolve)), delay(1500)]);
      if (browser.exitCode === null) browser.kill();
    }
    fs.writeFileSync(path.join(outputDir, 'player-diagnostic.json'), JSON.stringify({ url: redact(targetUrl.href), startedAt: new Date(started).toISOString(), elapsedMs: Date.now() - started, error: fatal ? redact(fatal.message) : null, browserStderr, events }, null, 2));
    // Only the profile made by this process is eligible for recursive cleanup.
    if (path.dirname(path.resolve(profile)) !== tempRoot || !path.basename(profile).startsWith('gametuoitho-player-profile-')) throw new Error('Own profile cleanup containment check failed');
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }); }
    catch (error) { print(`Own temporary profile cleanup deferred: ${error.code}`); }
    print(`Artifacts: ${outputDir}`);
  }
  if (fatal) throw fatal;
}

main().catch((error) => { console.error(`[player-diagnostic] ${redact(error.message)}`); process.exitCode = 1; });
