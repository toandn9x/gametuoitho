// Chrome touch events -> actual player -> actual emulator queue consumed by Java.
// Run against a public game page: node tests/pm/mobile-input-browser-review.cjs --url URL
// API mutations are intercepted. No server-side JAR execution or cloud writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const args = process.argv.slice(2);
assert.ok(args.length === 2 && args[0] === '--url', 'Usage: node tests/pm/mobile-input-browser-review.cjs --url URL');
const target = new URL(args[1]);
assert.ok(['http:', 'https:'].includes(target.protocol) && !target.username && !target.password);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const redact = value => String(value).replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[REDACTED_JWT]');
class CDP {
  constructor(url, listener) {
    this.ws = new WebSocket(url); this.pending = new Map(); this.id = 0;
    this.ready = new Promise((resolve, reject) => { this.ws.addEventListener('open', resolve, { once: true }); this.ws.addEventListener('error', () => reject(new Error('Chrome connection failed')), { once: true }); });
    this.ws.addEventListener('message', message => {
      const value = JSON.parse(String(message.data));
      if (value.id) { const pending = this.pending.get(value.id); if (!pending) return; clearTimeout(pending.timer); this.pending.delete(value.id); value.error ? pending.reject(new Error(value.error.message)) : pending.resolve(value.result); }
      else Promise.resolve(listener(value)).catch(error => { this.error = error; });
    });
  }
  async send(method, params = {}) {
    await this.ready; if (this.error) throw this.error;
    const id = ++this.id;
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 8000); this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async evaluate(expression) {
    const value = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
    return value.result.value;
  }
}
async function main() {
  const tempRoot = fs.realpathSync(os.tmpdir()), runDir = fs.mkdtempSync(path.join(tempRoot, 'gametuoitho-mobile-input-'));
  const profile = path.join(runDir, 'profile');
  let browser, cdp, failure, browserLog = '';
  const checks = [], blockedMutations = [], exceptions = [], responses = [];
  const print = message => console.log(`[mobile-input] ${redact(message)}`);
  const check = (name, pass, detail) => { checks.push({ name, pass: !!pass, detail }); print(`${pass ? 'PASS' : 'FAIL'} ${name}`); };
  const wait = async (probe, label, timeout = 45000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { if (cdp?.error) throw cdp.error; const value = await probe(); if (value) return value; await sleep(100); }
    throw new Error(`Timeout: ${label}`);
  };
  const input = () => cdp.evaluate("document.querySelector('iframe')?.contentWindow?.__mobileInputReview || null");
  const state = () => cdp.evaluate(`(()=>{const c=document.querySelector('iframe')?.contentDocument?.querySelector('#display');if(!c)return null;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let hash=0;for(let i=0;i<d.length;i+=52)hash=(hash*31+d[i]+d[i+1]*7+d[i+2]*13)>>>0;return {hash,width:c.width,height:c.height};})()`);
  async function screenshot(name) { const value = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(runDir, name + '.png'), Buffer.from(value.data, 'base64')); }
  async function point(selector) {
    return cdp.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b)return null;b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  }
  async function tap(selector, holdMs = 120, drift = false) {
    const p = await point(selector); assert.ok(p, `Missing phone key: ${selector}`);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 1 }] });
    await sleep(holdMs);
    if (drift) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x + 70, y: p.y + 45, id: 1 }] }); await sleep(100); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(220);
  }
  try {
    const chrome = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(value => value && fs.existsSync(value));
    assert.ok(chrome, 'Installed Chrome required');
    browser = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    browser.on('error', error => { failure = error; }); browser.stderr.on('data', data => { browserLog = (browserLog + redact(data)).slice(-4000); });
    const port = await wait(() => {
      if (failure) throw failure;
      const portFile = path.join(profile, 'DevToolsActivePort');
      if (!fs.existsSync(portFile)) return false;
      try {
        const value = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
        return Number.isInteger(value) && value > 0 && value < 65536 ? value : false;
      } catch (error) {
        if (['EBUSY', 'EPERM', 'ENOENT'].includes(error.code)) return false;
        throw error;
      }
    }, 'Chrome debugging port', 15000);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    cdp = new CDP(targets.find(value => value.type === 'page').webSocketDebuggerUrl, async ({ method, params = {} }) => {
      if (method === 'Runtime.exceptionThrown') exceptions.push(redact(params.exceptionDetails.exception?.description || params.exceptionDetails.text));
      if (method === 'Network.responseReceived' && params.response.url.startsWith(target.origin + '/emulator/src/')) responses.push({ url: params.response.url, status: params.response.status });
      if (method === 'Fetch.requestPaused') {
        const req = params.request, url = new URL(req.url);
        if (url.origin === target.origin && url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
          blockedMutations.push({ method: req.method, path: url.pathname });
          return cdp.send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{"success":true,"data":{}}').toString('base64') });
        }
        return cdp.send('Fetch.continueRequest', { requestId: params.requestId });
      }
    });
    await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('Network.enable')]);
    await cdp.send('Network.setBypassServiceWorker', { bypass: true });
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: target.origin + '/api/*' }] });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36', platform: 'Android', acceptLanguage: 'vi-VN,vi' });
    print(`Opening ${target.href} with Android UA and touch emulation; API mutations blocked.`);
    await cdp.send('Page.navigate', { url: target.href });
    await wait(() => cdp.evaluate("(()=>{const f=document.querySelector('iframe');return !!f?.contentWindow?.evtQueue?.started && !!f.contentDocument.querySelector('#loading')?.hidden;})()"), 'actual emulator/game input polling');
    await cdp.evaluate(`(()=>{
      const w=document.querySelector('iframe').contentWindow,q=w.evtQueue;
      const data=w.__mobileInputReview={queued:[],consumed:[],messages:[],pointer:[]};
      const add=q.queueEvent,wait=q.waitForEvent;
      q.queueEvent=function(event,...args){if(/^(key|pointer)/.test(event.kind))data.queued.push({...event,at:performance.now()});return add.call(this,event,...args);};
      q.waitForEvent=function(...args){const pending=wait.apply(this,args);pending.then(event=>{if(event&&/^(key|pointer)/.test(event.kind))data.consumed.push({...event,at:performance.now()});});return pending;};
      w.addEventListener('message',event=>{if(event.source===w.parent&&event.origin===w.location.origin&&event.data?.type==='KEY_EVENT')data.messages.push({code:event.data.code,pressed:event.data.pressed});});
      for(const type of ['pointerdown','pointerup','pointercancel'])window.addEventListener(type,event=>{if(event.target.closest?.('.nokia1280 button'))data.pointer.push({type,pointerType:event.pointerType});},true);
    })()`);
    check('actual game is visible and Java event loop is polling', true);
    const mobile = await cdp.evaluate("({touch:navigator.maxTouchPoints,coarse:matchMedia('(pointer:coarse)').matches,width:innerWidth,ua:navigator.userAgent})");
    check('browser uses mobile touch input', mobile.touch >= 2 && mobile.coarse, mobile);
    await screenshot('1-before-touch');
    const before = await state();
    const left = '.nokia1280__sidekeys:first-child button:first-child';
    await tap(left); await sleep(600);
    const after = await state();
    await screenshot('2-after-soft-left');
    check('touching soft-left visibly changes the actual game', before.hash !== after.hash, { before, after });
    await tap(left); await sleep(500); await screenshot('3-after-two-soft-left');
    const keys = [
      ['Enter',13,'.nokia1280__select'], ['ArrowUp',38,'.nokia1280__direction--up'], ['ArrowDown',40,'.nokia1280__direction--down'],
      ['ArrowLeft',37,'.nokia1280__direction--left'], ['ArrowRight',39,'.nokia1280__direction--right'],
      ...['1','2','3','4','5','6','7','8','9','*','0','#'].map((digit,index) => [digit === '*' ? 'NumpadMultiply' : digit === '#' ? 'NumpadDivide' : 'Digit'+digit, digit==='*'?106:digit==='#'?111:48+Number(digit), `.nokia1280__numbers button:nth-child(${index+1})`]),
      ['F2',113,'.nokia1280__sidekeys:last-child button:first-child'],
    ];
    for (const [code, nativeCode, selector] of keys) {
      const previous = await input(); await tap(selector);
      // Java dispatch is asynchronous and can take longer than a fixed 220ms
      // during a game transition. Wait for the observed release, not a timer.
      await wait(async () => (await input()).consumed.slice(previous.consumed.length).some(e => e.kind === 'keyup' && e.args[0] === nativeCode), `${code} release consumed`, 3000);
      const current = await input();
      const messages = current.messages.slice(previous.messages.length), consumed = current.consumed.slice(previous.consumed.length);
      check(`${code}: touch press/release reaches iframe`, messages.some(e=>e.code===code&&e.pressed) && messages.some(e=>e.code===code&&!e.pressed));
      check(`${code}: Java polling consumes press and release`, consumed.some(e=>e.kind==='keydown'&&e.args[0]===nativeCode) && consumed.some(e=>e.kind==='keyup'&&e.args[0]===nativeCode));
    }
    const previous = await input(); await tap('.nokia1280__direction--right', 800, true);
    await wait(async () => (await input()).consumed.slice(previous.consumed.length).some(e => e.kind === 'keyup' && e.args[0] === 39), 'held direction release consumed', 3000);
    const current = await input();
    const held = current.consumed.slice(previous.consumed.length).filter(e=>e.args?.[0]===39);
    check('hold repeats and release is delivered after finger drifts outside', held.filter(e=>e.kind==='keydown').length >= 2 && held.at(-1)?.kind==='keyup');
    const pending = await input(); const p = await point('.nokia1280__numbers button:nth-child(5)');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});await sleep(100);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await sleep(250);
    const cancelled = (await input()).consumed.slice(pending.consumed.length);
    check('touch cancellation releases the key', cancelled.some(e=>e.kind==='keyup'&&e.args[0]===53));
    await screenshot('4-after-keys');
    check('no uncaught browser exceptions', exceptions.length===0, exceptions);
    const captured = await input();
    fs.writeFileSync(path.join(runDir,'input-events.json'),JSON.stringify(captured,null,2));
    print(`${checks.filter(c=>c.pass).length}/${checks.length} checks passed.`);
  } catch (error) { failure=error; print(`FAILED: ${error.message}`); if(cdp)await screenshot('failure').catch(()=>{}); }
  finally {
    if(cdp){await cdp.send('Browser.close').catch(()=>{});cdp.ws.close();}
    if(browser&&browser.exitCode===null){browser.kill();await Promise.race([new Promise(resolve=>browser.once('close',resolve)),sleep(1500)]);}
    fs.writeFileSync(path.join(runDir,'results.json'),JSON.stringify({target:target.href,checks,blockedMutations,exceptions,responses,failure:failure?redact(failure.message):null,browserLog},null,2));
    const resolved=path.resolve(profile);assert.ok(path.dirname(resolved)===runDir&&path.basename(resolved)==='profile');
    if(fs.existsSync(resolved))fs.rmSync(resolved,{recursive:true,force:true,maxRetries:4,retryDelay:100});
    print(`Evidence: ${runDir}`);
  }
  if(failure||checks.some(c=>!c.pass))process.exitCode=1;
}
main().catch(error=>{console.error(redact(error.stack||error));process.exitCode=1;});
