import { Hono, Context } from 'hono';
import { GameService } from '../services/gameService';
import { GameQuerySchema } from '@gametuoitho/api-contracts';
import { AppEnv } from '../types';

export const gameRoutes = (getService: (c: Context<AppEnv>) => GameService) => {
  const router = new Hono<AppEnv>();

  router.get('/', async (c) => {
    const gameService = getService(c);
    const query = c.req.query();
    const parsed = GameQuerySchema.safeParse(query);

    if (!parsed.success || (c.req.queries('featured')?.length ?? 0) > 1) {
      return c.json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: !parsed.success ? parsed.error.errors[0]?.message : 'Chỉ được truyền featured một lần',
        },
      }, 400);
    }

    const res = await gameService.getPublicGames(parsed.data);

    return c.json({
      success: true,
      data: res.games,
      pagination: {
        page: res.page,
        limit: res.limit,
        total: res.total,
        totalPages: res.totalPages,
      },
    });
  });

  router.get('/:slug', async (c) => {
    const gameService = getService(c);
    const slug = c.req.param('slug');
    const detail = await gameService.getGameDetail(slug);

    if (!detail) {
      return c.json(
        {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Không tìm thấy game' },
        },
        404
      );
    }

    return c.json({ success: true, data: detail });
  });

  router.get('/:id/versions', async (c) => {
    const gameService = getService(c);
    const gameId = c.req.param('id');
    const versions = await gameService.getGameVersions(gameId);
    if (versions === null) {
      return c.json(
        {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Không tìm thấy game hoặc game chưa được xuất bản' },
        },
        404
      );
    }
    return c.json({ success: true, data: versions });
  });

  return router;
};
