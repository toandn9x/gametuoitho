// Range answers for emulator files served by the Cloudflare Worker (CheerpJ refuses a 200 to a Range request).
import assert from 'node:assert/strict';
import { withByteRange } from '../apps/api/src/middleware/byteRange';

const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
const full = (init: ResponseInit = {}) => new Response(bytes, {
  status: 200,
  headers: { 'Content-Type': 'application/java-archive', ETag: '"abc"', 'Content-Length': '1000' },
  ...init,
});
let passed = 0;
async function check(name: string, run: () => Promise<void>) {
  await run();
  passed++;
  console.log(`  ok - ${name}`);
}

async function slice(range: string) {
  const res = await withByteRange(range, full());
  return { res, body: new Uint8Array(await res.arrayBuffer()) };
}

(async () => {
  await check('no Range header → the full 200 response unchanged', async () => {
    const original = full();
    assert.equal(await withByteRange(undefined, original), original);
  });

  await check('bytes=0-0 (CheerpJ probe) → 206 with one byte and the total size', async () => {
    const { res, body } = await slice('bytes=0-0');
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('Content-Range'), 'bytes 0-0/1000');
    assert.equal(res.headers.get('Content-Length'), '1');
    assert.equal(res.headers.get('Accept-Ranges'), 'bytes');
    assert.equal(res.headers.get('Content-Type'), 'application/java-archive');
    assert.equal(res.headers.get('ETag'), '"abc"');
    assert.deepEqual([...body], [0]);
  });

  await check('middle chunk returns exactly those bytes', async () => {
    const { res, body } = await slice('bytes=262-511');
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('Content-Range'), 'bytes 262-511/1000');
    assert.deepEqual([...body], [...bytes.slice(262, 512)]);
  });

  await check('end past the file is clamped to the last byte', async () => {
    const { res, body } = await slice('bytes=900-131071');
    assert.equal(res.headers.get('Content-Range'), 'bytes 900-999/1000');
    assert.equal(body.length, 100);
  });

  await check('open-ended and suffix ranges', async () => {
    const open = await slice('bytes=990-');
    assert.equal(open.res.headers.get('Content-Range'), 'bytes 990-999/1000');
    const suffix = await slice('bytes=-10');
    assert.equal(suffix.res.headers.get('Content-Range'), 'bytes 990-999/1000');
    assert.deepEqual([...suffix.body], [...bytes.slice(990)]);
  });

  await check('start past the end → 416 with the size', async () => {
    const { res } = await slice('bytes=1000-1001');
    assert.equal(res.status, 416);
    assert.equal(res.headers.get('Content-Range'), 'bytes */1000');
  });

  await check('multi-range or other units → full 200 (allowed by HTTP)', async () => {
    for (const range of ['bytes=0-1,5-6', 'items=0-1', 'bytes=-']) {
      const res = await withByteRange(range, full());
      assert.equal(res.status, 200, range);
    }
  });

  await check('error responses pass through untouched', async () => {
    const missing = new Response('nope', { status: 404 });
    assert.equal(await withByteRange('bytes=0-0', missing), missing);
  });

  await check('a decoded body never keeps Content-Encoding (CheerpJ rejects compressed partials)', async () => {
    const res = await withByteRange('bytes=0-9', full({ headers: { 'Content-Encoding': 'br' } }));
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('Content-Encoding'), null);
  });

  console.log(`byte-range: ${passed} checks passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
