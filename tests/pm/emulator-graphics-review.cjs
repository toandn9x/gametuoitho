// Real Canvas/ImageBitmap APIs + actual graphics bridge; no JVM, game or cloud requests.
// PLAYWRIGHT_MODULE_PATH, CHROME_PATH, WEBKIT_EXECUTABLE_PATH may select existing installs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'apps/emulator-web/libjs/libcanvasgraphics.js'), 'utf8');
assert.equal(source, fs.readFileSync(path.join(root, 'apps/web/public/emulator/libjs/libcanvasgraphics.js'), 'utf8'), 'served graphics bridge must match source');

(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/graphics.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/graphics.js' ? source : '<!doctype html><title>Graphics regression</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const [name, engine, executablePath] of [
      ['Chrome', chromium, process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'],
      ['WebKit', webkit, process.env.WEBKIT_EXECUTABLE_PATH],
    ]) {
      const browser = await engine.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
      try {
        const page = await browser.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
        await page.goto(origin);
        const result = await page.evaluate(async () => {
          const bridge = (await import('/graphics.js')).default;
          const transform = (...args) => bridge.Java_pl_zb3_freej2me_bridge_graphics_CanvasImage_transformBitmap(null, ...args);
          const check = (condition, message) => { if (!condition) throw new Error(message); };
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 5;
          const context = canvas.getContext('2d'), pixels = context.createImageData(5, 5);
          for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
            pixels.data.set([x * 43, y * 47, (x + y) * 23, 255], (y * 5 + x) * 4);
          }
          context.putImageData(pixels, 0, 0);
          const bitmap = await createImageBitmap(canvas);
          const read = image => {
            const output = document.createElement('canvas');
            output.width = image.width; output.height = image.height;
            const ctx = output.getContext('2d');
            ctx.drawImage(image, 0, 0);
            return Array.from(ctx.getImageData(0, 0, image.width, image.height).data);
          };
          let ordinary = 0, empty = 0;
          for (const input of [canvas, bitmap]) for (let rotation = 0; rotation < 4; rotation++) for (const mirror of [false, true]) {
            const w = 2, h = 3, image = await transform(input, 1, 1, w, h, rotation, mirror);
            const width = rotation % 2 ? h : w, height = rotation % 2 ? w : h;
            check(image.width === width && image.height === height, 'ordinary crop dimensions changed');
            const expected = new Array(width * height * 4).fill(0);
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
              // Mirror the source horizontally, then rotate clockwise. Keep source crop offsets.
              const mx = mirror ? w - 1 - x : x;
              const [dx, dy] = [[mx, y], [h - 1 - y, mx], [w - 1 - mx, h - 1 - y], [y, w - 1 - mx]][rotation];
              expected.splice((dy * width + dx) * 4, 4, ...pixels.data.slice(((y + 1) * 5 + x + 1) * 4, ((y + 1) * 5 + x + 1) * 4 + 4));
            }
            check(JSON.stringify(read(image)) === JSON.stringify(expected), 'crop/mirror/rotation pixels changed: ' + rotation + '/' + mirror);
            image.close(); ordinary++;
          }
          for (const [w, h] of [[0, 8], [8, 0], [0, 0]]) for (let rotation = 0; rotation < 4; rotation++) for (const mirror of [false, true]) {
            const image = await transform(bitmap, 0, 0, w, h, rotation, mirror);
            check(image.width === 1 && image.height === 1, 'empty crop must have a browser-compatible bitmap');
            check(JSON.stringify(read(image)) === '[0,0,0,0]', 'empty crop must be transparent');
            image.close(); empty++;
          }
          const [first, second] = await Promise.all([
            transform(bitmap, 0, 0, 0, 8, 0, true),
            transform(bitmap, 0, 0, 0, 8, 0, true),
          ]);
          check(first !== second, 'empty images must not share a closeable bitmap handle');
          first.close();
          check(second.width === 1 && JSON.stringify(read(second)) === '[0,0,0,0]', 'closing one image must not invalidate another');
          second.close();
          const after = await transform(bitmap, 1, 1, 2, 3, 0, false);
          check(read(after)[0] === 43 && read(after)[1] === 47, 'empty crop contaminated later normal rendering');
          after.close(); bitmap.close();
          return { ordinary, empty, independentHandles: true, subsequentRendering: true };
        });
        assert.deepEqual(errors, []);
        console.log('PASS ' + name + ': ' + JSON.stringify(result));
      } finally { await browser.close(); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
