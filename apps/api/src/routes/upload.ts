import { Hono, Context } from 'hono';
import { UploadService } from '../services/uploadService';
import { requireAuth } from '../middleware/auth';
import { AssetType } from '@gametuoitho/shared-types';
import { AppEnv } from '../types';

export const uploadRoutes = (getService: (c: Context<AppEnv>) => UploadService) => {
  const router = new Hono<AppEnv>();

  // POST /upload - Upload file (Requires Auth)
  router.post('/upload', requireAuth, async (c) => {
    try {
      const uploadService = getService(c);
      const user = c.get('user')!;
      const body = await c.req.parseBody();

      const file = body['file'];
      if (!file || !(file instanceof File)) {
        return c.json(
          { success: false, error: { message: 'Vui lòng chọn file cần tải lên' } },
          400
        );
      }

      const assetType = (body['assetType'] as AssetType) || 'JAR';
      const gameId = body['gameId'] as string | undefined;
      const versionId = body['versionId'] as string | undefined;

      // Only ADMIN can upload directly to Catalog games
      if (gameId && user.role !== 'ADMIN') {
        return c.json(
          {
            success: false,
            error: { message: 'Chỉ quản trị viên mới có quyền upload asset vào Catalog' },
          },
          403
        );
      }

      const arrayBuffer = await file.arrayBuffer();

      const asset = await uploadService.uploadFile({
        userId: user.id,
        fileBuffer: arrayBuffer,
        originalFilename: file.name,
        assetType,
        mimeType: file.type || 'application/octet-stream',
        gameId,
        versionId,
      });

      return c.json({ success: true, data: asset }, 201);
    } catch (err: any) {
      return c.json({ success: false, error: { message: err.message } }, 400);
    }
  });

  // GET /assets/raw/:key - Raw asset delivery with full HTTP 206 Range support (Required for CheerpJ!)
  router.get('/assets/raw/:key', async (c) => {
    const uploadService = getService(c);
    const rawKey = c.req.param('key');
    const key = decodeURIComponent(rawKey);

    const asset = await uploadService.getFile(key);
    if (!asset) {
      return c.text('Asset Not Found', 404);
    }

    const totalSize = asset.data.byteLength;
    const rangeHeader = c.req.header('Range');

    // Default headers
    const headers: Record<string, string> = {
      'Accept-Ranges': 'bytes',
      'Content-Type': asset.contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
      'Cache-Control': 'public, max-age=86400',
    };

    if (rangeHeader && rangeHeader.startsWith('bytes=')) {
      const parts = rangeHeader.replace('bytes=', '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;

      if (start >= totalSize || end >= totalSize || start > end) {
        return new Response('Requested range not satisfiable', {
          status: 416,
          headers: {
            ...headers,
            'Content-Range': `bytes */${totalSize}`,
          },
        });
      }

      const chunk = asset.data.slice(start, end + 1);
      headers['Content-Range'] = `bytes ${start}-${end}/${totalSize}`;
      headers['Content-Length'] = String(chunk.byteLength);

      return new Response(chunk, {
        status: 206,
        headers,
      });
    }

    headers['Content-Length'] = String(totalSize);
    return new Response(asset.data, {
      status: 200,
      headers,
    });
  });

  return router;
};
