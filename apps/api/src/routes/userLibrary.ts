import { Hono, Context } from 'hono';
import { LibraryService } from '../services/libraryService';
import { requireAuth } from '../middleware/auth';
import { AddToLibrarySchema, AddImportToLibrarySchema, RecordActivitySchema } from '@gametuoitho/api-contracts';
import { AppEnv } from '../types';

export const userLibraryRoutes = (getService: (c: Context<AppEnv>) => LibraryService) => {
  const router = new Hono<AppEnv>();

  // All /me routes require authentication
  router.use('*', requireAuth);

  // Library
  router.get('/library', async (c) => {
    const libraryService = getService(c);
    const user = c.get('user')!;
    const items = await libraryService.getUserLibrary(user.id);
    return c.json({ success: true, data: items });
  });

  router.post('/library', async (c) => {
    try {
      const libraryService = getService(c);
      const user = c.get('user')!;
      const body = await c.req.json();
      const parsed = AddToLibrarySchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Dữ liệu không hợp lệ' },
          },
          400
        );
      }

      const res = await libraryService.addCatalogGameToLibrary(
        user.id,
        parsed.data.game_id,
        parsed.data.game_version_id
      );
      return c.json({ success: true, data: res }, 201);
    } catch (err: any) {
      return c.json({ success: false, error: { message: err.message } }, 400);
    }
  });

  router.delete('/library/:id', async (c) => {
    try {
      const libraryService = getService(c);
      const user = c.get('user')!;
      const id = c.req.param('id');
      const res = await libraryService.removeFromLibrary(user.id, id);
      return c.json({ success: true, data: res });
    } catch (err: any) {
      return c.json({ success: false, error: { message: err.message } }, 400);
    }
  });

  // User Imports
  router.get('/imports', async (c) => {
    const libraryService = getService(c);
    const user = c.get('user')!;
    const imports = await libraryService.getUserImports(user.id);
    return c.json({ success: true, data: imports });
  });

  router.post('/imports', async (c) => {
    try {
      const libraryService = getService(c);
      const user = c.get('user')!;
      const body = await c.req.json();
      const parsed = AddImportToLibrarySchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Dữ liệu không hợp lệ' },
          },
          400
        );
      }

      const res = await libraryService.addImportToLibrary(
        user.id,
        parsed.data.custom_name,
        parsed.data.jar_asset_id
      );
      return c.json({ success: true, data: res }, 201);
    } catch (err: any) {
      return c.json({ success: false, error: { message: err.message } }, 400);
    }
  });

  // Favorites
  router.get('/favorites', async (c) => {
    const libraryService = getService(c);
    const user = c.get('user')!;
    const favorites = await libraryService.getFavorites(user.id);
    return c.json({ success: true, data: favorites });
  });

  router.post('/favorites', async (c) => {
    try {
      const libraryService = getService(c);
      const user = c.get('user')!;
      const body = await c.req.json();
      if (!body.game_id) {
        return c.json(
          { success: false, error: { message: 'Cần cung cấp game_id' } },
          400
        );
      }

      const res = await libraryService.toggleFavorite(user.id, body.game_id);
      return c.json({ success: true, data: res });
    } catch (err: any) {
      return c.json({ success: false, error: { message: err.message } }, 400);
    }
  });

  // History / Activity
  router.get('/history', async (c) => {
    const libraryService = getService(c);
    const user = c.get('user')!;
    const history = await libraryService.getPlayHistory(user.id);
    return c.json({ success: true, data: history });
  });

  router.post('/history', async (c) => {
    try {
      const libraryService = getService(c);
      const user = c.get('user')!;
      const body = await c.req.json();
      const parsed = RecordActivitySchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          { success: false, error: { message: 'Dữ liệu không hợp lệ' } },
          400
        );
      }

      const res = await libraryService.recordPlay(
        user.id,
        parsed.data.game_id,
        parsed.data.user_library_id
      );
      return c.json({ success: true, data: res });
    } catch (err: any) {
      return c.json({ success: false, error: { message: err.message } }, 400);
    }
  });

  return router;
};
