import { User } from '@gametuoitho/shared-types';
import { DatabaseClient } from './repositories/db';
import { StorageDriver } from './storage/storage';
import { AuthService } from './services/authService';
import { GameService } from './services/gameService';
import { LibraryService } from './services/libraryService';
import { UploadService } from './services/uploadService';
import { AdminService } from './services/adminService';
import { CrawlerService } from './services/crawlerService';
import { StorageService } from './services/storageService';
import { ReportRepository } from './repositories/reportRepository';
import { UserRepository } from './repositories/userRepository';
import { GameRepository } from './repositories/gameRepository';
import { AuditRepository } from './repositories/auditRepository';

export interface Bindings {
  DB: any;
  BUCKET: any;
  JWT_SECRET: string;
  ENVIRONMENT?: string;
  _dbClient?: DatabaseClient;
  _storageDriver?: StorageDriver;
}

export interface Variables {
  user?: User;
  services?: {
    authService: AuthService;
    gameService: GameService;
    libraryService: LibraryService;
    uploadService: UploadService;
    adminService: AdminService;
    crawlerService: CrawlerService;
    storageService: StorageService;
    reportRepo: ReportRepository;
    userRepo: UserRepository;
    gameRepo: GameRepository;
    auditRepo: AuditRepository;
  };
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};
