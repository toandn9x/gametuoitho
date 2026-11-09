import { Hono, Context } from 'hono';
import { UploadService } from '../services/uploadService';
import { requireAuth, getJwtSecret } from '../middleware/auth';
import { AssetType } from '@gametuoitho/shared-types';
import { AppEnv } from '../types';

export const uploadRoutes = (getService: (c: Context<AppEnv>) => UploadService) => {
  const router = new Hono<AppEnv>();

  // POST /upload - Upload file (Requires Auth)
  router.post('/upload', requireAuth, async (c) => {
    try {
      const uploadService = getService(c);
      const user = c.get('user')!;

      // 1. Check Content-Length before parsing full body
      const contentLength = c.req.header('content-length');
      if (contentLength && Number(contentLength) > 50 * 1024 * 1024) {
        return c.json(
          { success: false, error: { message: 'Dung lượng payload vượt quá giới hạn 50MB cho phép' } },
          413
        );
      }

      const body = await c.req.parseBody();

      const file = body['file'];
      if (!file || !(file instanceof File)) {
        return c.json(
          { success: false, error: { message: 'Vui lòng chọn file cần tải lên' } },
          400
        );
      }

      // Check file size before reading full arrayBuffer
      if (file.size > 50 * 1024 * 1024) {
        return c.json(
          { success: false, error: { message: 'Dung lượng file vượt quá giới hạn 50MB cho phép' } },
          413
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
        userRole: user.role,
        fileBuffer: arrayBuffer,
        originalFilename: file.name,
        assetType,
        mimeType: file.type || 'application/octet-stream',
        gameId,
        versionId,
      });

      return c.json({ success: true, data: asset }, 201);
    } catch (err: any) {
      const status = (err.status && typeof err.status === 'number') ? err.status : 400;
      return c.json({ success: false, error: { message: err.message } }, status);
    }
  });

  // OPTIONS /assets/raw/:key{.*} - CORS Preflight
  router.options('/assets/raw/:key{.*}', (c) => {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type, Authorization',
        'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
        'Access-Control-Max-Age': '86400',
      },
    });
  });

  // GET & HEAD /assets/raw/:key{.*} - Raw asset delivery with strict authorization and Range support
  router.on(['GET', 'HEAD'], '/assets/raw/:key{.*}', async (c) => {
    const uploadService = getService(c);
    const rawKey = c.req.param('key');

    // Double-encoding check: %25 in URL or param represents double-encoded percent
    if (c.req.url.includes('%25') || rawKey.includes('%25') || rawKey.includes('%2F') || rawKey.includes('%2f')) {
      return new Response('Asset Not Found', {
        status: 404,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }

    let key: string;
    try {
      key = decodeURIComponent(rawKey);
    } catch {
      return new Response('Asset Not Found', {
        status: 404,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }

    // Traversal and encoding checks
    if (key.includes('%') || key.includes('\0') || key.includes('\\')) {
      return new Response('Asset Not Found', {
        status: 404,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    const pathSegments = key.split('/');
    for (const segment of pathSegments) {
      if (segment === '..' || segment === '.') {
        return new Response('Asset Not Found', {
          status: 404,
          headers: { 'Cache-Control': 'private, no-store' },
        });
      }
    }

    const jwtSecret = getJwtSecret(
      c.env?.JWT_SECRET || process.env.JWT_SECRET,
      c.env?.ENVIRONMENT || process.env.NODE_ENV
    );
    const authHeader = c.req.header('Authorization');
    const cookieHeader = c.req.header('Cookie');

    // Authorization check MUST happen before reading any bytes from storage
    const authRes = await uploadService.checkAssetAccess(key, jwtSecret, authHeader, cookieHeader);
    if (!authRes.allowed || !authRes.asset) {
      return new Response('Access Denied', {
        status: authRes.status,
        headers: {
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    // Only read object after authorization passes
    const assetRecord = authRes.asset;
    const fileObj = await uploadService.getFile(key);
    if (!fileObj) {
      return new Response('Asset Not Found', {
        status: 404,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }

    const totalSize = fileObj.data.byteLength;
    const isHead = c.req.method.toUpperCase() === 'HEAD';

    // Determine content type & disposition
    let contentType = 'application/octet-stream';
    let disposition = 'attachment';

    if (assetRecord.asset_type === 'JAR') {
      contentType = 'application/java-archive';
      const filename = encodeURIComponent(assetRecord.original_filename || 'game.jar');
      disposition = `attachment; filename="${filename}"`;
    } else if (assetRecord.asset_type === 'JAD') {
      contentType = 'text/vnd.sun.j2me.app-descriptor';
      const filename = encodeURIComponent(assetRecord.original_filename || 'game.jad');
      disposition = `attachment; filename="${filename}"`;
    } else if (assetRecord.asset_type === 'COVER' || assetRecord.asset_type === 'SCREENSHOT') {
      const mime = (assetRecord.mime_type || '').toLowerCase();
      if (mime === 'image/webp' || key.endsWith('.webp')) {
        contentType = 'image/webp';
        disposition = 'inline';
      } else if (mime === 'image/png' || key.endsWith('.png')) {
        contentType = 'image/png';
        disposition = 'inline';
      } else if (mime === 'image/jpeg' || mime === 'image/jpg' || key.endsWith('.jpg') || key.endsWith('.jpeg')) {
        contentType = 'image/jpeg';
        disposition = 'inline';
      }
    }

    const headers: Record<string, string> = {
      'Accept-Ranges': 'bytes',
      'Content-Type': contentType,
      'Content-Disposition': disposition,
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type, Authorization',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
      'Cache-Control': 'no-store',
    };

    const rangeHeader = c.req.header('Range');
    if (rangeHeader && rangeHeader.startsWith('bytes=')) {
      const spec = rangeHeader.substring(6).trim();

      // Disallow multiple ranges
      if (spec.includes(',')) {
        return new Response(isHead ? null : 'Requested range not satisfiable', {
          status: 416,
          headers: {
            ...headers,
            'Content-Range': `bytes */${totalSize}`,
          },
        });
      }

      let start = 0;
      let end = totalSize - 1;
      let valid = true;

      if (spec.startsWith('-')) {
        // Suffix range: -N
        const suffixStr = spec.substring(1);
        if (!/^\d+$/.test(suffixStr)) {
          valid = false;
        } else {
          const suffix = parseInt(suffixStr, 10);
          if (suffix === 0 || totalSize === 0) {
            valid = false;
          } else {
            start = Math.max(0, totalSize - suffix);
            end = totalSize - 1;
          }
        }
      } else if (spec.endsWith('-')) {
        // Open-ended range: N-
        const startStr = spec.slice(0, -1);
        if (!/^\d+$/.test(startStr)) {
          valid = false;
        } else {
          start = parseInt(startStr, 10);
          if (start >= totalSize) {
            valid = false;
          } else {
            end = totalSize - 1;
          }
        }
      } else {
        // Closed range: N-M
        const parts = spec.split('-');
        if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) {
          valid = false;
        } else {
          start = parseInt(parts[0], 10);
          const rawEnd = parseInt(parts[1], 10);
          if (start > rawEnd || start >= totalSize) {
            valid = false;
          } else {
            end = Math.min(rawEnd, totalSize - 1);
          }
        }
      }

      if (!valid) {
        return new Response(isHead ? null : 'Requested range not satisfiable', {
          status: 416,
          headers: {
            ...headers,
            'Content-Range': `bytes */${totalSize}`,
          },
        });
      }

      const chunkLength = end - start + 1;
      headers['Content-Range'] = `bytes ${start}-${end}/${totalSize}`;
      headers['Content-Length'] = String(chunkLength);

      const chunk = isHead ? null : fileObj.data.slice(start, end + 1);
      return new Response(chunk, {
        status: 206,
        headers,
      });
    }

    headers['Content-Length'] = String(totalSize);
    const body = isHead ? null : fileObj.data;
    return new Response(body, {
      status: 200,
      headers,
    });
  });

  return router;
};
