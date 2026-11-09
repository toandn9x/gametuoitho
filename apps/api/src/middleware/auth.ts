import { Context, Next } from 'hono';
import { verifyJwt } from '@gametuoitho/shared-utils';
import { User } from '@gametuoitho/shared-types';
import { AppEnv } from '../types';

export const authMiddleware = async (c: Context<AppEnv>, next: Next) => {
  const authHeader = c.req.header('Authorization');
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else {
    // Check cookie fallback
    const cookieHeader = c.req.header('Cookie');
    if (cookieHeader) {
      const match = cookieHeader.match(/token=([^;]+)/);
      if (match) token = match[1];
    }
  }

  if (token) {
    const secret = c.env?.JWT_SECRET || process.env.JWT_SECRET || 'gametuoitho-dev-secret';
    const payload = await verifyJwt(token, secret);
    if (payload && payload.userId) {
      c.set('user', {
        id: payload.userId,
        username: payload.username,
        role: payload.role,
        email: payload.email,
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as User);
    }
  }

  await next();
};

export const requireAuth = async (c: Context<AppEnv>, next: Next) => {
  const user = c.get('user');
  if (!user) {
    return c.json(
      {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Vui lòng đăng nhập để thực hiện chức năng này',
        },
      },
      401
    );
  }
  await next();
};

export const requireAdmin = async (c: Context<AppEnv>, next: Next) => {
  const user = c.get('user');
  if (!user) {
    return c.json(
      {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Yêu cầu đăng nhập quản trị',
        },
      },
      401
    );
  }

  if (user.role !== 'ADMIN') {
    return c.json(
      {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Bạn không có quyền quản trị viên',
        },
      },
      403
    );
  }

  await next();
};
