import { Hono, Context } from 'hono';
import { AdminService } from '../services/adminService';
import { requireAuth, requireAdmin } from '../middleware/auth';
import {
  CreateGameSchema,
  UpdateGameSchema,
  CreateCategorySchema,
  UpdateCategorySchema,
  CreateVersionSchema,
} from '@gametuoitho/api-contracts';
import { AppEnv } from '../types';

export const adminRoutes = (getService: (c: Context<AppEnv>) => AdminService) => {
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
    const limit = Number(c.req.query('limit') || '50');
    const res = await adminService.getAllGames(page, limit);
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

      const updated = await adminService.updateGame(gameId, parsed.data);
      return c.json({ success: true, data: updated });
    } catch (err: any) {
      return c.json({ success: false, error: { message: err.message } }, 400);
    }
  });

  router.delete('/games/:id', async (c) => {
    try {
      const adminService = getService(c);
      const gameId = c.req.param('id');
      const res = await adminService.deleteGame(gameId);
      return c.json({ success: true, data: res });
    } catch (err: any) {
      return c.json({ success: false, error: { message: err.message } }, 400);
    }
  });

  router.post('/games/:id/publish', async (c) => {
    try {
      const adminService = getService(c);
      const gameId = c.req.param('id');
      const res = await adminService.publishGame(gameId);
      return c.json({ success: true, data: res });
    } catch (err: any) {
      return c.json({ success: false, error: { message: err.message } }, 400);
    }
  });

  router.post('/games/:id/hide', async (c) => {
    try {
      const adminService = getService(c);
      const gameId = c.req.param('id');
      const res = await adminService.hideGame(gameId);
      return c.json({ success: true, data: res });
    } catch (err: any) {
      return c.json({ success: false, error: { message: err.message } }, 400);
    }
  });

  // Versions
  router.post('/games/:id/versions', async (c) => {
    try {
      const adminService = getService(c);
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

      const res = await adminService.addVersion(gameId, parsed.data);
      return c.json({ success: true, data: res }, 201);
    } catch (err: any) {
      return c.json({ success: false, error: { message: err.message } }, 400);
    }
  });

  router.delete('/versions/:id', async (c) => {
    try {
      const adminService = getService(c);
      const versionId = c.req.param('id');
      const res = await adminService.deleteVersion(versionId);
      return c.json({ success: true, data: res });
    } catch (err: any) {
      return c.json({ success: false, error: { message: err.message } }, 400);
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

  return router;
};
