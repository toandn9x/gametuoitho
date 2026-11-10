/**
 * The emulator (CheerpJ) reads freej2me-web.jar in byte ranges and stops when a Range request is
 * answered with the whole file ("HTTP server does not support the 'Range' header. CheerpJ cannot run.").
 * Workers Static Assets ignore Range and always reply 200. Chrome hides this by serving later ranges
 * from its HTTP cache; Safari and the in-app browsers of Zalo/Facebook/Messenger on iPhone do not, so
 * the game never starts there. These files go through the Worker (see run_worker_first in wrangler.toml).
 */
export const RANGE_ASSET_PATHS = ['/emulator/freej2me-web.jar'];

/** Turn a full 200 asset response into the 206/416 answer for one `bytes=` range. */
export async function withByteRange(rangeHeader: string | undefined, full: Response): Promise<Response> {
  const match = rangeHeader?.trim().match(/^bytes=(\d*)-(\d*)$/);
  // No range, a multi-range or other unit (a server may ignore those), or an error/redirect: unchanged.
  if (!match || (!match[1] && !match[2]) || full.status !== 200) return full;

  const body = await full.arrayBuffer();
  const size = body.byteLength;
  let start: number;
  let end: number;
  if (!match[1]) {
    start = Math.max(0, size - Number(match[2])); // "bytes=-N": the last N bytes
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }

  const headers = new Headers(full.headers);
  headers.set('Accept-Ranges', 'bytes');
  // The bytes below are the decoded body; a leftover Content-Encoding would make CheerpJ refuse them.
  headers.delete('Content-Encoding');
  if (start >= size || start > end) {
    headers.set('Content-Range', `bytes */${size}`);
    headers.set('Content-Length', '0');
    return new Response(null, { status: 416, headers });
  }
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(body.slice(start, end + 1), { status: 206, headers });
}
