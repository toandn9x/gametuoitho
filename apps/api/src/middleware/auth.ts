import { Context, Next } from 'hono';
import { verifyJwt } from '@gametuoitho/shared-utils';
import { User } from '@gametuoitho/shared-types';
import { UserRepository } from '../repositories/userRepository';
import { D1DatabaseClient } from '../repositories/db';
import { AppEnv } from '../types';

let devEphemeralSecret: string | null = null;

/**
 * Resolves JWT secret according to R05-A:
 * - Production: JWT_SECRET required, minimum 32 chars.
 * - Dev/Test: ephemeral random secret generated if not provided.
 * - No static fallback string in code.
 */
export function getJwtSecret(envSecret?: string, environment?: string): string {
  const isProd =
    environment === 'production' || process.env.NODE_ENV === 'production';

  if (envSecret && envSecret.trim().length > 0) {
    if (isProd && envSecret.length < 32) {
      throw new Error('JWT_SECRET must have at least 32 characters in production');
    }
    return envSecret;
  }

  if (isProd) {
    throw new Error('JWT_SECRET environment variable is required in production (minimum 32 characters)');
  }

  if (!devEphemeralSecret) {
    devEphemeralSecret = crypto.randomUUID() + '-' + crypto.randomUUID() + '-' + crypto.randomUUID();
    console.warn('[Security] DEV MODE: Using ephemeral random JWT secret.');
  }

  return devEphemeralSecret;
}

/**
 * Extracts Bearer token or exact 'token' cookie.
 * Strictly ignores csrftoken=, xtoken=, etc. (R05-A).
 */
export function extractToken(authHeader?: string | null, cookieHeader?: string | null): string | undefined {
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);
    if (match) return match[1].trim();
  }
  return undefined;
}

export const authMiddleware = async (c: Context<AppEnv>, next: Next) => {
  const authHeader = c.req.header('Authorization');
  const cookieHeader = c.req.header('Cookie');
  const token = extractToken(authHeader, cookieHeader);

  if (token) {
    try {
      const secret = getJwtSecret(
        c.env?.JWT_SECRET || process.env.JWT_SECRET,
        c.env?.ENVIRONMENT || process.env.NODE_ENV
      );

      const payload = await verifyJwt(token, secret);
      if (payload && payload.userId) {
        // Resolve user repository to re-verify status, role, and token_version against DB
        let userRepo: UserRepository | undefined = c.get('services')?.userRepo;
        if (!userRepo) {
          const dbClient = (c.env as any)?._dbClient;
          if (dbClient) {
            userRepo = new UserRepository(dbClient);
          } else if (c.env?.DB) {
            userRepo = new UserRepository(new D1DatabaseClient(c.env.DB));
          }
        }

        if (userRepo) {
          const dbUser = await userRepo.findById(payload.userId);
          // 1. User must exist and have ACTIVE status
          if (dbUser && dbUser.status === 'ACTIVE') {
            // 2. Token version check: match tokenVersion if user.token_version is present
            const tokenVer = payload.tokenVersion ?? 0;
            const dbVer = dbUser.token_version ?? 0;
            if (tokenVer === dbVer) {
              // 3. Authoritative role from DB (prevent stale elevated token claims)
              c.set('user', dbUser);
            }
          }
        } else {
          // Fallback if no database configured
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
    } catch {
      // Invalid secret configuration or malformed token -> user remains unset
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
