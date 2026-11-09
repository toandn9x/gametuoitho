import { Hono, Context } from 'hono';
import { GameService } from '../services/gameService';
import { AppEnv } from '../types';

export const categoryRoutes = (getService: (c: Context<AppEnv>) => GameService) => {
  const router = new Hono<AppEnv>();

  router.get('/', async (c) => {
    const gameService = getService(c);
    const categories = await gameService.getCategories();
    return c.json({ success: true, data: categories });
  });

  router.get('/:slug/games', async (c) => {
    const gameService = getService(c);
    const slug = c.req.param('slug');
    const page = Number(c.req.query('page') || '1');
    const limit = Number(c.req.query('limit') || '20');

    const res = await gameService.getPublicGames({
      categorySlug: slug,
      page,
      limit,
    });

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

  return router;
};
