import { Hono, Context } from 'hono';
import { AdminService } from '../services/adminService';
import { StorageService } from '../services/storageService';
import { requireAuth, requireAdmin } from '../middleware/auth';
import {
  CreateGameSchema,
  UpdateGameSchema,
  CreateCategorySchema,
  UpdateCategorySchema,
  CreateVersionSchema,
  BulkDeleteAssetsSchema,
} from '@gametuoitho/api-contracts';
import { AppEnv } from '../types';

export const adminRoutes = (
  getService: (c: Context<AppEnv>) => AdminService,
  getStorageService?: (c: Context<AppEnv>) => StorageService
) => {
  const router = new Hono<AppEnv>();

  // All admin routes require authentication and ADMIN role
  router.use('*', requireAuth, requireAdmin);

  // Stats / Dashboard
  router.get('/stats', async (c) => {
    const adminService = getService(c);
    const stats = await adminService.getDashboardStats();
    return c.json({ success: true, data: stats });
  });

  // Games CRUD
  router.get('/games', async (c) => {
    const adminService = getService(c);
    const page = Number(c.req.query('page') || '1');
    const limit = Number(c.req.query('limit') || '100');
    const status = c.req.query('status') as any;
    const search = c.req.query('search') || undefined;
    const res = await adminService.getAllGames(page, limit, status, search);
    return c.json({ success: true, data: res.games, total: res.total, page, limit });
  });

  router.post('/games', async (c) => {
    try {
      const adminService = getService(c);
      const user = c.get('user')!;
      const body = await c.req.json();
      const parsed = CreateGameSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message },
          },
          400
        );
      }

      const game = await adminService.createGame(user.id, parsed.data);
      return c.json({ success: true, data: game }, 201);
    } catch (err: any) {
      return c.json({ success: false, error: { message: err.message } }, 400);
    }
  });

  router.put('/games/:id', async (c) => {
    try {
      const adminService = getService(c);
      const gameId = c.req.param('id');
      const body = await c.req.json();
      const parsed = UpdateGameSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message },
          },
          400
        );
      }

      const user = c.get('user');
      const updated = await adminService.updateGame(gameId, parsed.data, user?.id);
      return c.json({ success: true, data: updated });
    } catch (err: any) {
      const status = err.status || 400;
      const code = err.code || (status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST');
      return c.json({ success: false, error: { code, message: err.message } }, status);
    }
  });

  router.delete('/games/:id', async (c) => {
    try {
      const adminService = getService(c);
      const user = c.get('user');
      const gameId = c.req.param('id');
      const res = await adminService.deleteGame(gameId, user?.id);
      return c.json({ success: true, data: res });
    } catch (err: any) {
      const status = err.status || 400;
      const code = err.code || (status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST');
      return c.json({ success: false, error: { code, message: err.message } }, status);
    }
  });

  const handlePublish = async (c: any) => {
    try {
      const adminService = getService(c);
      const user = c.get('user');
      const gameId = c.req.param('id');
      const res = await adminService.publishGame(gameId, user?.id);
      return c.json({ success: true, data: res });
    } catch (err: any) {
      const status = err.status || 400;
      const code = err.code || (status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST');
      return c.json({ success: false, error: { code, message: err.message } }, status);
    }
  };

  router.post('/games/:id/publish', handlePublish);
  router.put('/games/:id/publish', handlePublish);

  router.post('/games/:id/hide', async (c) => {
    try {
      const adminService = getService(c);
      const user = c.get('user');
      const gameId = c.req.param('id');
      const res = await adminService.hideGame(gameId, user?.id);
      return c.json({ success: true, data: res });
    } catch (err: any) {
      const status = err.status || 400;
      const code = err.code || (status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST');
      return c.json({ success: false, error: { code, message: err.message } }, status);
    }
  });

  // Versions
  router.post('/games/:id/versions', async (c) => {
    try {
      const adminService = getService(c);
      const user = c.get('user');
      const gameId = c.req.param('id');
      const body = await c.req.json();
      const parsed = CreateVersionSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message },
          },
          400
        );
      }

      const res = await adminService.addVersion(gameId, parsed.data, user?.id);
      return c.json({ success: true, data: res }, 201);
    } catch (err: any) {
      const status = err.status || 400;
      const code = err.code || (status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST');
      return c.json({ success: false, error: { code, message: err.message } }, status);
    }
  });

  router.delete('/versions/:id', async (c) => {
    try {
      const adminService = getService(c);
      const user = c.get('user');
      const versionId = c.req.param('id');
      const res = await adminService.deleteVersion(versionId, user?.id);
      return c.json({ success: true, data: res });
    } catch (err: any) {
      const status = err.status || 400;
      const code = err.code || (status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST');
      return c.json({ success: false, error: { code, message: err.message } }, status);
    }
  });

  // Categories CRUD
  router.post('/categories', async (c) => {
    try {
      const adminService = getService(c);
      const body = await c.req.json();
      const parsed = CreateCategorySchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message },
          },
          400
        );
      }

      const cat = await adminService.createCategory(parsed.data);
      return c.json({ success: true, data: cat }, 201);
    } catch (err: any) {
      return c.json({ success: false, error: { message: err.message } }, 400);
    }
  });

  router.put('/categories/:id', async (c) => {
    try {
      const adminService = getService(c);
      const id = c.req.param('id');
      const body = await c.req.json();
      const parsed = UpdateCategorySchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message },
          },
          400
        );
      }

      const updated = await adminService.updateCategory(id, parsed.data);
      return c.json({ success: true, data: updated });
    } catch (err: any) {
      return c.json({ success: false, error: { message: err.message } }, 400);
    }
  });

  router.delete('/categories/:id', async (c) => {
    try {
      const adminService = getService(c);
      const id = c.req.param('id');
      const res = await adminService.deleteCategory(id);
      return c.json({ success: true, data: res });
    } catch (err: any) {
      return c.json({ success: false, error: { message: err.message } }, 400);
    }
  });

  // User Imports
  router.get('/imports', async (c) => {
    const adminService = getService(c);
    const page = Number(c.req.query('page') || '1');
    const limit = Number(c.req.query('limit') || '50');
    const res = await adminService.getUserImports(page, limit);
    return c.json({ success: true, data: res.imports, total: res.total, page, limit });
  });

  // Assets
  router.get('/assets', async (c) => {
    const adminService = getService(c);
    const page = Number(c.req.query('page') || '1');
    const limit = Number(c.req.query('limit') || '50');
    const assets = await adminService.getAssets(page, limit);
    return c.json({ success: true, data: assets });
  });

  // Storage Analysis & Cleanup
  router.get('/storage/analysis', async (c) => {
    try {
      const storageService = getStorageService ? getStorageService(c) : null;
      if (!storageService) {
        return c.json({ success: false, error: { message: 'Storage service không sẵn sàng' } }, 500);
      }
      const analysis = await storageService.analyzeStorage();
      return c.json({ success: true, data: analysis });
    } catch (err: any) {
      return c.json({ success: false, error: { message: err.message } }, 500);
    }
  });

  router.post('/storage/cleanup', async (c) => {
    try {
      const storageService = getStorageService ? getStorageService(c) : null;
      if (!storageService) {
        return c.json(
          { success: false, error: { code: 'SERVER_ERROR', message: 'Storage service không sẵn sàng' } },
          500
        );
      }
      const body = await c.req.json().catch(() => ({}));
      const result = await storageService.cleanupStorage({
        cleanOrphans: body.cleanOrphans !== false,
        purgeDeleted: body.purgeDeleted !== false,
        purgeQuarantined: body.purgeQuarantined === true,
        safetyWindowMs: body.safetyWindowMs,
      });
      return c.json({ success: true, data: result });
    } catch (err: any) {
      return c.json({ success: false, error: { message: err.message } }, 500);
    }
  });

  router.delete('/assets/:id', async (c) => {
    const storageService = getStorageService ? getStorageService(c) : null;
    if (!storageService) {
      return c.json(
        { success: false, error: { code: 'SERVER_ERROR', message: 'Storage service không sẵn sàng' } },
        500
      );
    }
    const assetId = c.req.param('id');
    try {
      const result = await storageService.deleteAssetById(assetId);
      return c.json({ success: true, message: 'Đã xóa asset thành công!', data: result });
    } catch (err: any) {
      const status = err.status || 400;
      const code = err.code || (status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : 'BAD_REQUEST');
      return c.json({ success: false, error: { code, message: err.message } }, status);
    }
  });

  router.post('/assets/bulk-delete', async (c) => {
    const storageService = getStorageService ? getStorageService(c) : null;
    if (!storageService) {
      return c.json(
        { success: false, error: { code: 'SERVER_ERROR', message: 'Storage service không sẵn sàng' } },
        500
      );
    }
    const body = await c.req.json().catch(() => null);
    const parse = BulkDeleteAssetsSchema.safeParse(body);
    if (!parse.success) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: parse.error.errors[0]?.message || 'Dữ liệu không hợp lệ',
            details: parse.error.format(),
          },
        },
        400
      );
    }
    const result = await storageService.bulkDeleteAssets(parse.data.ids);
    return c.json({ success: true, data: result });
  });

  return router;
};
