import { Hono, Context } from 'hono';
import { GameService } from '../services/gameService';
import { AppEnv } from '../types';

export const searchRoutes = (getService: (c: Context<AppEnv>) => GameService) => {
  const router = new Hono<AppEnv>();

  router.get('/', async (c) => {
    const gameService = getService(c);
    const q = c.req.query('q') || '';
    if (!q.trim()) {
      return c.json({ success: true, data: [] });
    }

    const games = await gameService.searchGames(q.trim());
    return c.json({ success: true, data: games });
  });

  return router;
};
