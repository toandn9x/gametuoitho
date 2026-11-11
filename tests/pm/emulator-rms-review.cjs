// Run after pnpm cf:build. Requires JDK 19+, Chrome, Playwright and the CheerpJ CDN.
// Compiles only this trusted fixture; game/fixture JARs execute exclusively in Chrome.
// All API responses are local fixtures. No database or production writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = path.resolve(__dirname, '../..');
const dist = path.join(root, 'apps/web/dist');
const runtime = path.join(root, 'apps/emulator-web/freej2me-web.jar');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gametuoitho-rms-'));
const jdk = tool => process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', tool) : tool;
const source = `
import javax.microedition.midlet.MIDlet;
import javax.microedition.lcdui.*;
import javax.microedition.rms.RecordStore;
public class SaveProbe extends MIDlet {
  protected void startApp() {
    try {
      String label = getAppProperty("Fixture-Label");
      RecordStore store = RecordStore.openRecordStore("review_state", true);
      String previous = store.getNumRecords() == 0 ? "EMPTY" : new String(store.getRecord(1), "UTF-8");
      byte[] bytes = label.getBytes("UTF-8");
      if (store.getNumRecords() == 0) store.addRecord(bytes, 0, bytes.length);
      else store.setRecord(1, bytes, 0, bytes.length);
      store.closeRecordStore();
      Display.getDisplay(this).setCurrent(new Screen());
      System.out.println("RMS_PROBE expected=" + label + " actual=" + previous);
    } catch (Exception error) { error.printStackTrace(); }
  }
  protected void pauseApp() {}
  protected void destroyApp(boolean unconditional) {}
  static class Screen extends Canvas {
    protected void paint(Graphics g) { g.setColor(0x102030); g.fillRect(0, 0, getWidth(), getHeight()); }
  }
}`;
fs.writeFileSync(path.join(output, 'SaveProbe.java'), source);
execFileSync(jdk('javac'), ['--release', '8', '-g:none', '-proc:none', '-classpath', runtime,
  '-d', output, path.join(output, 'SaveProbe.java')], { stdio: 'pipe' });
for (const label of ['A', 'B']) {
  const manifest = path.join(output, label + '.mf');
  fs.writeFileSync(manifest, 'Manifest-Version: 1.0\nMIDlet-Name: Shared Save Probe\nMIDlet-Vendor: Fixture\nMIDlet-Version: 1.0\nMIDlet-1: Shared Save Probe,,SaveProbe\nMicroEdition-Configuration: CLDC-1.1\nMicroEdition-Profile: MIDP-2.0\nFixture-Label: ' + label + '\n\n');
  execFileSync(jdk('jar'), ['--create', '--file', path.join(output, label + '.jar'), '--manifest', manifest,
    '-C', output, 'SaveProbe.class', '-C', output, 'SaveProbe$Screen.class'], { stdio: 'pipe' });
}
const installedLaunch = /const SaveIsolation = await lib\.pl\.zb3\.freej2me\.launcher\.SaveIsolation;\s*const installedAppId = await SaveIsolation\.prepare\(jarFilePath, jarName\);\s*args = \['app', installedAppId\];/;
const main = fs.readFileSync(path.join(root, 'apps/emulator-web/src/main.js'), 'utf8');
assert.match(main, installedLaunch, 'legacy seeding must replace only the new launch adapter');
const legacyMain = main.replace(installedLaunch, "args = ['jar', jarFilePath];");
const observations = [], errors = [], logs = [];
const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(new URL(req.url, 'http://fixture').pathname);
  const json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ success: true, data })); };
  if (pathname.startsWith('/api/v1/games/rms-')) {
    const slug = pathname.split('/').pop(), label = slug.includes('-b') ? 'B' : 'A';
    return json({ game: { id: slug, name: slug, slug }, versions: [{ id: 'version-' + slug,
      jar_url: '/api/v1/assets/raw/' + label + '.jar' }], screenshots: [] });
  }
  if (/^\/api\/v1\/assets\/raw\/[AB]\.jar$/.test(pathname)) {
    res.setHeader('Content-Type', 'application/java-archive');
    return res.end(fs.readFileSync(path.join(output, path.basename(pathname))));
  }
  if (pathname.startsWith('/api/')) return json([]);
  if (pathname.startsWith('/play/')) pathname = '/play/_shell/index.html';
  const file = path.resolve(dist, '.' + pathname);
  if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  const size = fs.statSync(file).size, range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    const start = Number(range[1]), end = range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.setHeader('Content-Length', size); fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    async function scenario(name, steps) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
      try {
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {
          logs.push(message.text());
          const match = /RMS_PROBE expected=([AB]) actual=(\w+)/.exec(message.text());
          if (match) observations.push({ scenario: name, game: match[1], previous: match[2] });
        });
        let legacy = false;
        await context.route('**/emulator/src/main.js', route => route.fulfill({ contentType: 'text/javascript', body: legacy ? legacyMain : main }));
        for (const [slug, previous, old = false] of steps) {
          legacy = old;
          const before = observations.length;
          await page.goto(origin + '/play/' + slug);
          await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow?.libmidi?.context, {}, { timeout: 90000 });
          await page.locator('[data-emulator-key="Digit5"]:visible').click({ delay: 100 });
          const deadline = Date.now() + 90000;
          while (observations.length === before && Date.now() < deadline) await page.waitForTimeout(100);
          assert.equal(observations.length, before + 1, 'fixture must actually execute in CheerpJ: ' + slug);
          logs.push(JSON.stringify({ slug, files: await page.locator('iframe').evaluate(async frame => {
            const read = async file => { try { return await (await frame.contentWindow.cjFileBlob('/files/' + file))?.text(); } catch { return null; } };
            return { owner: await read('Shared Save Probe/.save-owner'), ready: await read('_gtt_version-rms-a/.save-ready') };
          }) }));
          assert.equal(observations.at(-1).previous, previous, name + ': ' + slug);
          await page.waitForTimeout(1800); // Allow CheerpJ's IndexedDB persistence before navigation.
          console.log('PASS ' + name + ': ' + slug + (old ? ' (legacy)' : '') + ' reads ' + previous);
        }
      } finally { await context.close(); }
    }
    await scenario('separate saves and relaunch', [['rms-a', 'EMPTY'], ['rms-b', 'EMPTY'], ['rms-a', 'A'], ['rms-b', 'B']]);
    await scenario('legacy compatibility', [
      ['rms-a', 'EMPTY', true], // Seed a real save using the old launcher in the browser.
      ['rms-b', 'EMPTY'],       // A different JAR must not inherit A's save despite the same MIDlet name.
      ['rms-a', 'A'],           // Matching JAR retains its old progress.
      ['rms-a-copy', 'EMPTY'],  // An identical JAR under another ID cannot claim the same legacy save.
      ['rms-a', 'A'], ['rms-b', 'B'], ['rms-a', 'A', true], // The legacy original still exists.
    ]);
    assert.deepEqual(errors, []);
    console.log('11/11 real-browser RMS checks passed. Evidence: ' + output);
  } finally {
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ observations, errors, logs }, null, 2));
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
