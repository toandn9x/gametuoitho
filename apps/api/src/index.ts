import { Hono, Context } from 'hono';
import { cors } from 'hono/cors';
import { D1DatabaseClient, DatabaseClient } from './repositories/db';
import { StorageDriver } from './storage/storage';
import { createCloudStorage } from './storage/factory';
import { UserRepository } from './repositories/userRepository';
import { GameRepository } from './repositories/gameRepository';
import { CategoryRepository } from './repositories/categoryRepository';
import { AssetRepository } from './repositories/assetRepository';
import { LibraryRepository } from './repositories/libraryRepository';
import { ReportRepository } from './repositories/reportRepository';
import { AuditRepository } from './repositories/auditRepository';
import { UploadJobRepository } from './repositories/uploadJobRepository';
import { StatsRepository } from './repositories/statsRepository';

import { AuthService } from './services/authService';
import { GameService } from './services/gameService';
import { LibraryService } from './services/libraryService';
import { UploadService } from './services/uploadService';
import { AdminService } from './services/adminService';
import { CrawlerService } from './services/crawlerService';
import { StorageService } from './services/storageService';

import { authMiddleware, getJwtSecret } from './middleware/auth';
import { authRoutes } from './routes/auth';
import { gameRoutes } from './routes/games';
import { categoryRoutes } from './routes/categories';
import { searchRoutes } from './routes/search';
import { userLibraryRoutes } from './routes/userLibrary';
import { uploadRoutes } from './routes/upload';
import { adminRoutes } from './routes/admin';
import { crawlerRoutes } from './routes/crawler';
import { publicReportRoutes, adminReportRoutes } from './routes/reports';
import { AppEnv } from './types';

export function createApp(
  customDb?: DatabaseClient,
  customStorage?: StorageDriver
) {
  const app = new Hono<AppEnv>();

  // CORS Middleware
  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'Range'],
      exposeHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges'],
      maxAge: 86400,
    })
  );

  // Attach services to context before auth extraction
  app.use('*', async (c, next) => {
    getServices(c);
    await next();
  });

  // Global Auth extraction middleware
  app.use('*', authMiddleware);

  // Health check
  app.get('/health', (c) => {
    return c.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      platform: 'Cloudflare Workers / Hono',
    });
  });

  // Helper to create and cache services for the current context
  const getServices = (c: Context<AppEnv>) => {
    let services = c.get('services');
    if (!services) {
      const dbClient =
        customDb ||
        c.env._dbClient ||
        new D1DatabaseClient(c.env.DB);

      const storageDriver =
        customStorage ||
        c.env._storageDriver ||
        createCloudStorage(c.env);

      const jwtSecret = getJwtSecret(
        c.env?.JWT_SECRET || process.env.JWT_SECRET,
        c.env?.ENVIRONMENT || process.env.NODE_ENV
      );

      const userRepo = new UserRepository(dbClient);
      const gameRepo = new GameRepository(dbClient);
      const categoryRepo = new CategoryRepository(dbClient);
      const assetRepo = new AssetRepository(dbClient);
      const libraryRepo = new LibraryRepository(dbClient);
      const reportRepo = new ReportRepository(dbClient);
      const auditRepo = new AuditRepository(dbClient);
      const uploadJobRepo = new UploadJobRepository(dbClient);

      const storageService = new StorageService(assetRepo, storageDriver);

      services = {
        authService: new AuthService(userRepo, jwtSecret),
        gameService: new GameService(gameRepo, categoryRepo, storageDriver),
        libraryService: new LibraryService(libraryRepo, gameRepo, assetRepo, storageDriver),
        uploadService: new UploadService(assetRepo, storageDriver, userRepo, uploadJobRepo),
        adminService: new AdminService(
          gameRepo,
          categoryRepo,
          assetRepo,
          userRepo,
          libraryRepo,
          storageDriver,
          storageService,
          auditRepo,
          new StatsRepository(dbClient)
        ),
        crawlerService: new CrawlerService(
          gameRepo,
          categoryRepo,
          assetRepo,
          storageDriver
        ),
        storageService,
        reportRepo,
        userRepo,
        gameRepo,
        auditRepo,
      };
      c.set('services', services);
    }
    return services;
  };

  // Mount API v1 Routes directly
  const v1 = new Hono<AppEnv>();

  v1.route('/auth', authRoutes((c) => getServices(c).authService));
  v1.route('/games', gameRoutes((c) => getServices(c).gameService));
  v1.route('/categories', categoryRoutes((c) => getServices(c).gameService));
  v1.route('/search', searchRoutes((c) => getServices(c).gameService));
  v1.route('/me', userLibraryRoutes((c) => getServices(c).libraryService));
  v1.route('/', uploadRoutes((c) => getServices(c).uploadService));
  v1.route('/reports', publicReportRoutes((c) => getServices(c).reportRepo, (c) => getServices(c).gameRepo));
  v1.route('/admin/reports', adminReportRoutes((c) => getServices(c).reportRepo));
  v1.route('/admin/crawler', crawlerRoutes((c) => getServices(c).crawlerService));
  v1.route('/admin', adminRoutes(
    (c) => getServices(c).adminService,
    (c) => getServices(c).storageService
  ));

  app.route('/api/v1', v1);

  // 404 Handler for unmatched API routes on all methods
  app.notFound((c) => {
    if (c.req.path.startsWith('/api/') || c.req.path === '/health') {
      return c.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'API route not found',
          },
        },
        404
      );
    }
    return c.text('Not Found', 404);
  });

  // Global Error Handler
  app.onError((err, c) => {
    console.error('Unhandled Application Error:', err);
    return c.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: err.message || 'Đã xảy ra lỗi hệ thống',
        },
      },
      500
    );
  });

  return app;
}

export default createApp();
