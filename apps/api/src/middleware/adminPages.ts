import type { Context } from 'hono';
import type { AppEnv } from '../types';

/** HTML pages of the admin UI (not the /api/v1/admin JSON API, which has its own requireAdmin). */
export const ADMIN_PAGE_PATTERN = /^\/admin(?:\/|$)/;

export type AdminPageDecision =
  | { kind: 'allow' }
  | { kind: 'login'; location: string }
  | { kind: 'forbidden' };

/**
 * Decide whether the current request may receive an /admin HTML page. Shared by the Node server and
 * the Cloudflare Worker. `user` was resolved by authMiddleware from the `token` cookie, with status,
 * token version and role re-read from the database.
 */
export function decideAdminPageAccess(c: Context<AppEnv>): AdminPageDecision {
  const user = c.get('user');
  if (user?.role === 'ADMIN') return { kind: 'allow' };

  if (!user) {
    const hadToken = /(?:^|;\s*)token=[^;]+/.test(c.req.header('Cookie') || '');
    const url = new URL(c.req.url);
    const params = new URLSearchParams({ reason: hadToken ? 'expired' : 'login', next: url.pathname + url.search });
    return { kind: 'login', location: `/login?${params.toString()}` };
  }

  return { kind: 'forbidden' };
}

export const FORBIDDEN_FALLBACK_HTML =
  '<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><title>403</title></head><body><h1>403 - Không có quyền truy cập trang quản trị</h1><a href="/">Về trang chủ</a></body></html>';
