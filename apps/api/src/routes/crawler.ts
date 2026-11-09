import { Hono, Context } from 'hono';
import { CrawlerService } from '../services/crawlerService';
import { requireAdmin } from '../middleware/auth';
import { AppEnv } from '../types';

export const crawlerRoutes = (getService: (c: Context<AppEnv>) => CrawlerService) => {
  const router = new Hono<AppEnv>();

  // All crawler routes require ADMIN role
  router.use('*', requireAdmin);

  // GET /admin/crawler/games - Search & Browse gametuoitho.cc catalog
  router.get('/games', async (c) => {
    try {
      const crawlerService = getService(c);
      const search = c.req.query('search') || undefined;
      const category = c.req.query('category') || undefined;
      const page = Number(c.req.query('page')) || 1;
      const limit = Number(c.req.query('limit')) || 24;

      const result = await crawlerService.searchSourceGames({
        search,
        category,
        page,
        limit,
      });

      return c.json({
        success: true,
        data: result.games,
        pagination: result.pagination,
      });
    } catch (err: any) {
      return c.json(
        { success: false, error: { message: err.message || 'Lỗi khi tải danh mục nguồn' } },
        500
      );
    }
  });

  // POST /admin/crawler/import - Import a single game
  router.post('/import', async (c) => {
    try {
      const crawlerService = getService(c);
      const user = c.get('user')!;
      const body = await c.req.json();
      const gameId = body.gameId as string;

      if (!gameId) {
        return c.json(
          { success: false, error: { message: 'Vui lòng cung cấp gameId cần nhập' } },
          400
        );
      }

      const imported = await crawlerService.importGameFromSource(gameId, user.id);

      return c.json({
        success: true,
        data: imported,
        message: `Đã nhập game "${imported.game.name}" vào Catalog thành công!`,
      });
    } catch (err: any) {
      return c.json(
        { success: false, error: { message: err.message || 'Lỗi khi nhập game' } },
        400
      );
    }
  });

  // POST /admin/crawler/batch-import - Import multiple games
  router.post('/batch-import', async (c) => {
    try {
      const crawlerService = getService(c);
      const user = c.get('user')!;
      const body = await c.req.json();
      const gameIds = body.gameIds as string[];

      if (!Array.isArray(gameIds) || gameIds.length === 0) {
        return c.json(
          { success: false, error: { message: 'Danh sách gameIds không hợp lệ' } },
          400
        );
      }

      const imported: any[] = [];
      const errors: { gameId: string; error: string }[] = [];

      for (const id of gameIds) {
        try {
          const res = await crawlerService.importGameFromSource(id, user.id);
          imported.push(res);
        } catch (e: any) {
          errors.push({ gameId: id, error: e.message });
        }
      }

      return c.json({
        success: true,
        data: {
          importedCount: imported.length,
          errorCount: errors.length,
          imported,
          errors,
        },
      });
    } catch (err: any) {
      return c.json(
        { success: false, error: { message: err.message || 'Lỗi khi nhập hàng loạt game' } },
        500
      );
    }
  });

  return router;
};
