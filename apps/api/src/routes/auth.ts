import { Hono, Context } from 'hono';
import { RegisterSchema, LoginSchema } from '@gametuoitho/api-contracts';
import { AuthService } from '../services/authService';
import { requireAuth } from '../middleware/auth';
import { verifyGoogleIdToken, GoogleTokenError } from '../services/googleIdToken';
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

  // Public sign-in options for the login / register pages. The Google client id is public by design.
  router.get('/config', (c) => {
    return c.json({ success: true, data: { googleClientId: googleClientId(c) || null } });
  });

  // Sign in with Google: body { credential } = the ID token from Google Identity Services.
  router.post('/google', async (c) => {
    const clientId = googleClientId(c);
    if (!clientId) {
      return c.json(
        { success: false, error: { code: 'GOOGLE_NOT_CONFIGURED', message: 'Đăng nhập Google chưa được bật trên máy chủ.' } },
        503
      );
    }

    let credential: unknown;
    try {
      credential = (await c.req.json())?.credential;
    } catch {
      credential = undefined;
    }
    if (typeof credential !== 'string' || credential.length === 0 || credential.length > 8192) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Thiếu thông tin đăng nhập Google.' } }, 400);
    }

    try {
      const jwksUrl = c.env?.GOOGLE_JWKS_URL || process.env.GOOGLE_JWKS_URL || undefined;
      const identity = await verifyGoogleIdToken(credential, clientId, { jwksUrl });
      const res = await getService(c).loginWithGoogle(identity);
      return c.json({ success: true, data: res });
    } catch (err: any) {
      if (err instanceof GoogleTokenError) {
        return c.json({ success: false, error: { code: 'GOOGLE_TOKEN_INVALID', message: err.message } }, 400);
      }
      const status = err.status === 403 || err.status === 409 ? err.status : 500;
      return c.json(
        { success: false, error: { code: err.code || 'GOOGLE_LOGIN_FAILED', message: status === 500 ? 'Đăng nhập Google thất bại. Vui lòng thử lại.' : err.message } },
        status
      );
    }
  });

  return router;
};

function googleClientId(c: Context<AppEnv>): string {
  return (c.env?.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '').trim();
}
