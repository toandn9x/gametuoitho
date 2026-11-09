import { Hono, Context } from 'hono';
import { RegisterSchema, LoginSchema } from '@gametuoitho/api-contracts';
import { AuthService } from '../services/authService';
import { requireAuth } from '../middleware/auth';
import { AppEnv } from '../types';

export const authRoutes = (getService: (c: Context<AppEnv>) => AuthService) => {
  const router = new Hono<AppEnv>();

  router.post('/register', async (c) => {
    try {
      const authService = getService(c);
      const body = await c.req.json();
      const parsed = RegisterSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: parsed.error.errors[0]?.message || 'Dữ liệu không hợp lệ',
            },
          },
          400
        );
      }

      const res = await authService.register(parsed.data);
      return c.json({ success: true, data: res }, 201);
    } catch (err: any) {
      return c.json(
        {
          success: false,
          error: { code: 'REGISTER_FAILED', message: err.message },
        },
        400
      );
    }
  });

  router.post('/login', async (c) => {
    try {
      const authService = getService(c);
      const body = await c.req.json();
      const parsed = LoginSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: parsed.error.errors[0]?.message || 'Dữ liệu không hợp lệ',
            },
          },
          400
        );
      }

      const res = await authService.login(parsed.data);
      return c.json({ success: true, data: res });
    } catch (err: any) {
      return c.json(
        {
          success: false,
          error: { code: 'LOGIN_FAILED', message: err.message },
        },
        401
      );
    }
  });

  router.get('/me', requireAuth, async (c) => {
    const authService = getService(c);
    const user = c.get('user')!;
    const safeUser = await authService.getCurrentUser(user.id);
    return c.json({ success: true, data: safeUser });
  });

  router.post('/logout', requireAuth, async (c) => {
    const authService = getService(c);
    const user = c.get('user')!;
    await authService.logout(user.id);
    return c.json({ success: true, message: 'Đăng xuất thành công' });
  });

  return router;
};
