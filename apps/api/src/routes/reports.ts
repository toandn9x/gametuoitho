import { Hono, Context } from 'hono';
import { ReportRepository, CrashReport } from '../repositories/reportRepository';
import { GameRepository } from '../repositories/gameRepository';
import { requireAdmin } from '../middleware/auth';
import { generateId } from '@gametuoitho/shared-utils';
import { CreateCrashReportSchema } from '@gametuoitho/api-contracts';
import { AppEnv } from '../types';

// In-memory rate limiter: max 10 requests / minute per client (IP or userId)
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  // Periodic cleanup if map grows
  if (rateLimits.size > 2000) {
    for (const [k, v] of rateLimits.entries()) {
      if (v.resetAt <= now) rateLimits.delete(k);
    }
  }

  const record = rateLimits.get(key);
  if (record && record.resetAt > now) {
    if (record.count >= 10) {
      return false;
    }
    record.count++;
    return true;
  }

  rateLimits.set(key, { count: 1, resetAt: now + 60000 });
  return true;
}

// Public Report Routes (e.g. /api/v1/reports/crash)
export const publicReportRoutes = (
  getRepo: (c: Context<AppEnv>) => ReportRepository,
  getGameRepo?: (c: Context<AppEnv>) => GameRepository
) => {
  const router = new Hono<AppEnv>();

  router.post('/crash', async (c) => {
    try {
      // 1. Body size limit: reject > 32KB with 413 Payload Too Large
      const contentLength = Number(c.req.header('content-length') || '0');
      if (contentLength > 32 * 1024) {
        return c.json(
          {
            success: false,
            error: {
              code: 'PAYLOAD_TOO_LARGE',
              message: 'Kích thước báo cáo vượt quá giới hạn cho phép (32KB)',
            },
          },
          413
        );
      }

      const rawBody = await c.req.text();
      if (rawBody.length > 32 * 1024) {
        return c.json(
          {
            success: false,
            error: {
              code: 'PAYLOAD_TOO_LARGE',
              message: 'Kích thước báo cáo vượt quá giới hạn cho phép (32KB)',
            },
          },
          413
        );
      }

      let jsonBody: any;
      try {
        jsonBody = JSON.parse(rawBody);
      } catch {
        return c.json(
          {
            success: false,
            error: {
              code: 'INVALID_JSON',
              message: 'Dữ liệu báo cáo không phải JSON hợp lệ',
            },
          },
          400
        );
      }

      // 2. Rate limiting: max 10 requests / 60 seconds per IP or userId
      const user = c.get('user');
      const ip =
        c.req.header('cf-connecting-ip') ||
        c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
        'unknown-ip';
      const clientKey = user?.id ? `user:${user.id}` : `ip:${ip}`;

      if (!checkRateLimit(clientKey)) {
        return c.json(
          {
            success: false,
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'Bạn đã gửi quá nhiều báo cáo lỗi. Vui lòng thử lại sau 1 phút.',
            },
          },
          429
        );
      }

      // 3. Zod schema validation
      const normalizedBody = {
        game_id: jsonBody.game_id ?? jsonBody.gameId ?? null,
        game_version_id: jsonBody.game_version_id ?? jsonBody.gameVersionId ?? null,
        game_slug: jsonBody.game_slug ?? jsonBody.gameSlug ?? null,
        game_name: jsonBody.game_name ?? jsonBody.gameName ?? null,
        error_type: jsonBody.error_type ?? jsonBody.errorType ?? 'CRASH',
        error_message: jsonBody.error_message ?? jsonBody.errorMessage,
        stack_trace: jsonBody.stack_trace ?? jsonBody.stackTrace ?? null,
      };

      const parseResult = CreateCrashReportSchema.safeParse(normalizedBody);
      if (!parseResult.success) {
        const firstError = parseResult.error.errors[0]?.message || 'Dữ liệu báo cáo không hợp lệ';
        return c.json(
          {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: firstError,
              details: parseResult.error.errors,
            },
          },
          400
        );
      }

      const validatedData = parseResult.data;

      // 4. Game existence check & authoritative name lookup from DB
      let authoritativeGameName = validatedData.game_name || 'Trò chơi không xác định';
      let gameRepo: GameRepository | undefined;
      if (getGameRepo) {
        try {
          gameRepo = getGameRepo(c);
        } catch {
          // Ignore if gameRepo unavailable
        }
      }

      if (validatedData.game_id || validatedData.game_slug) {
        if (gameRepo) {
          let foundGame = null;
          if (validatedData.game_id) {
            foundGame = await gameRepo.findById(validatedData.game_id);
          } else if (validatedData.game_slug) {
            foundGame = await gameRepo.findBySlug(validatedData.game_slug);
          }

          if (!foundGame) {
            return c.json(
              {
                success: false,
                error: {
                  code: 'GAME_NOT_FOUND',
                  message: 'Không tìm thấy trò chơi tương ứng với thông tin đã cung cấp',
                },
              },
              400
            );
          }

          authoritativeGameName = foundGame.name;
        }
      }

      const repo = getRepo(c);
      const userAgent = c.req.header('user-agent') || 'Unknown';

      const report: CrashReport = {
        id: generateId(),
        game_id: validatedData.game_id || null,
        game_version_id: validatedData.game_version_id || null,
        game_slug: validatedData.game_slug || null,
        game_name: authoritativeGameName,
        user_id: user?.id || null,
        error_type: validatedData.error_type,
        error_message: validatedData.error_message,
        stack_trace: validatedData.stack_trace || null,
        user_agent: userAgent,
        status: 'OPEN',
        admin_notes: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await repo.createReport(report);

      return c.json({
        success: true,
        data: { id: report.id },
        message: 'Báo cáo lỗi đã được ghi nhận. Cảm ơn bạn đã phản hồi!',
      });
    } catch (err: any) {
      return c.json({ success: false, error: { message: err.message || 'Lỗi gửi báo cáo' } }, 400);
    }
  });

  return router;
};

// Admin Report Routes (e.g. /api/v1/admin/reports)
export const adminReportRoutes = (getRepo: (c: Context<AppEnv>) => ReportRepository) => {
  const router = new Hono<AppEnv>();

  router.use('*', requireAdmin);

  router.get('/', async (c) => {
    try {
      const repo = getRepo(c);
      const page = Number(c.req.query('page') || '1');
      const limit = Number(c.req.query('limit') || '50');
      const status = c.req.query('status') as any;
      const errorType = c.req.query('errorType') as any;
      const search = c.req.query('search') || undefined;

      const { reports, total } = await repo.findReports({ page, limit, status, errorType, search });
      const stats = await repo.getStats();

      return c.json({
        success: true,
        data: reports,
        total,
        page,
        limit,
        stats,
      });
    } catch (err: any) {
      return c.json({ success: false, error: { message: err.message } }, 500);
    }
  });

  router.put('/:id', async (c) => {
    try {
      const repo = getRepo(c);
      const id = c.req.param('id');
      const body = await c.req.json();

      await repo.updateReport(id, {
        status: body.status,
        admin_notes: body.admin_notes,
      });

      return c.json({ success: true, message: 'Đã cập nhật trạng thái báo cáo!' });
    } catch (err: any) {
      return c.json({ success: false, error: { message: err.message } }, 400);
    }
  });

  router.delete('/:id', async (c) => {
    try {
      const repo = getRepo(c);
      const id = c.req.param('id');
      await repo.deleteReport(id);
      return c.json({ success: true, message: 'Đã xóa bản ghi báo cáo lỗi!' });
    } catch (err: any) {
      return c.json({ success: false, error: { message: err.message } }, 400);
    }
  });

  return router;
};
