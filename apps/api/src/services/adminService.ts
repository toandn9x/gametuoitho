import { GameRepository } from '../repositories/gameRepository';
import { CategoryRepository } from '../repositories/categoryRepository';
import { AssetRepository } from '../repositories/assetRepository';
import { UserRepository } from '../repositories/userRepository';
import { LibraryRepository } from '../repositories/libraryRepository';
import { AuditRepository } from '../repositories/auditRepository';
import { StatsRepository } from '../repositories/statsRepository';
import { StorageDriver } from '../storage/storage';
import { StorageService } from './storageService';
import { AdminUserQueryInput, CreateGameInput, UpdateGameInput, CreateCategoryInput, CreateVersionInput, UpdateUserStatusInput } from '@gametuoitho/api-contracts';
import { generateId } from '@gametuoitho/shared-utils';
import { Game } from '@gametuoitho/shared-types';

export class AdminService {
  constructor(
    private gameRepo: GameRepository,
    private categoryRepo: CategoryRepository,
    private assetRepo: AssetRepository,
    private userRepo: UserRepository,
    private libraryRepo: LibraryRepository,
    private storage: StorageDriver,
    private storageService?: StorageService,
    private auditRepo?: AuditRepository,
    private statsRepo?: StatsRepository
  ) {}

  private async logAudit(params: {
    userId: string;
    action: string;
    targetType: string;
    targetId?: string | null;
    details?: any;
  }) {
    if (this.auditRepo) {
      await this.auditRepo.log({
        userId: params.userId,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId,
        details: params.details,
      });
    }
  }

  /**
   * Predicate policy: A game can ONLY be PUBLISHED if it has at least one active Catalog version
   * whose JAR asset is active, of type JAR, and not stored under users/ (R01 & R05-B).
   */
  async validatePublishPolicy(gameId: string): Promise<void> {
    const versions = await this.gameRepo.findVersionsByGameId(gameId, true);
    if (!versions || versions.length === 0) {
      const err: any = new Error('Không thể xuất bản: Game chưa có phiên bản hoạt động nào');
      err.status = 400;
      throw err;
    }

    let hasValidCatalogVersion = false;
    for (const v of versions) {
      if (v.status !== 'ACTIVE' || !v.jar_asset_id) continue;
      const jarAsset = await this.assetRepo.findById(v.jar_asset_id);
      if (!jarAsset || jarAsset.status !== 'ACTIVE' || jarAsset.asset_type !== 'JAR') continue;
      // Must be a Catalog asset (not a user private import)
      if (jarAsset.storage_key.startsWith('users/')) continue;
      hasValidCatalogVersion = true;
      break;
    }

    if (!hasValidCatalogVersion) {
      const err: any = new Error('Không thể xuất bản: Game phải có ít nhất 1 phiên bản JAR Catalog hợp lệ và đang hoạt động');
      err.status = 400;
      throw err;
    }
  }

  async getDashboardStats() {
    const gameStats = await this.gameRepo.count();
    const userCount = await this.userRepo.count();
    const importCount = await this.libraryRepo.countImports();
    const totalStorageBytes = await this.assetRepo.getTotalStorageBytes();

    return {
      totalGames: gameStats.total,
      publishedGames: gameStats.published,
      draftGames: gameStats.draft,
      totalUsers: userCount,
      totalImports: importCount,
      totalStorageBytes,
      storageFormatted: `${(totalStorageBytes / (1024 * 1024)).toFixed(2)} MB`,
      activity: this.statsRepo ? await this.statsRepo.getActivitySummary() : null,
    };
  }

  async getAllGames(page = 1, limit = 50, status?: Game['status'], search?: string) {
    const res = await this.gameRepo.findGames({ page, limit, status, search });
    return {
      games: res.games.map((g: any) => ({
        ...g,
        cover_url: g.cover_storage_key ? this.storage.getUrl(g.cover_storage_key) : null,
      })),
      total: res.total,
      page,
      limit,
    };
  }

  async getUsers(query: AdminUserQueryInput) {
    return this.userRepo.findForAdmin(query);
  }

  async updateUserStatus(adminId: string, userId: string, input: UpdateUserStatusInput) {
    const user = await this.userRepo.findAccountForAdmin(userId);
    if (!user) {
      throw Object.assign(new Error('Không tìm thấy người dùng'), { status: 404, code: 'NOT_FOUND' });
    }
    if (userId === adminId || user.role === 'ADMIN') {
      throw Object.assign(new Error('Không thể đổi trạng thái tài khoản quản trị viên'), { status: 403, code: 'FORBIDDEN' });
    }
    const changed = await this.userRepo.updateMemberStatus(userId, input.status);
    if (changed) {
      await this.logAudit({
        userId: adminId, action: 'UPDATE_USER_STATUS', targetType: 'USER', targetId: userId,
        details: { previousStatus: user.status, status: input.status },
      });
    }
    return this.userRepo.findAccountForAdmin(userId);
  }

  async createGame(adminId: string, input: CreateGameInput): Promise<Game> {
    const id = generateId();
    const existing = await this.gameRepo.findBySlug(input.slug);
    if (existing) {
      const err: any = new Error('Slug này đã tồn tại, vui lòng chọn slug khác');
      err.status = 400;
      throw err;
    }

    if (input.status === 'PUBLISHED') {
      const err: any = new Error('Game mới tạo chưa có phiên bản JAR hợp lệ, không thể đặt trạng thái PUBLISHED');
      err.status = 400;
      throw err;
    }

    const game: Game = {
      id,
      name: input.name,
      slug: input.slug,
      description: input.description || null,
      developer: input.developer || null,
      publisher: input.publisher || null,
      release_year: input.release_year || null,
      category_id: input.category_id,
      cover_asset_id: input.cover_asset_id || null,
      status: input.status || 'DRAFT',
      visibility: input.visibility || 'PUBLIC',
      is_featured: input.is_featured ?? false,
      source_type: 'ADMIN',
      created_by: adminId,
      published_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await this.gameRepo.createGame(game);
    await this.logAudit({ userId: adminId, action: 'CREATE_GAME', targetType: 'GAME', targetId: id, details: { name: game.name, slug: game.slug } });
    return game;
  }

  async updateGame(gameId: string, input: UpdateGameInput, adminId = 'admin') {
    const game = await this.gameRepo.findById(gameId);
    if (!game) {
      const err: any = new Error('Game không tồn tại');
      err.status = 404;
      throw err;
    }

    if (input.slug && input.slug !== game.slug) {
      const existing = await this.gameRepo.findBySlug(input.slug);
      if (existing) {
        const err: any = new Error('Slug này đã được sử dụng');
        err.status = 400;
        throw err;
      }
    }

    // Policy check for transition to PUBLISHED
    if (input.status === 'PUBLISHED') {
      await this.validatePublishPolicy(gameId);
      (input as any).published_at = game.published_at || new Date().toISOString();
    }

    await this.gameRepo.updateGame(gameId, input);
    await this.logAudit({ userId: adminId, action: 'UPDATE_GAME', targetType: 'GAME', targetId: gameId, details: input });
    return this.gameRepo.findById(gameId);
  }

  async publishGame(gameId: string, adminId = 'admin') {
    const game = await this.gameRepo.findById(gameId);
    if (!game) {
      const err: any = new Error('Game không tồn tại');
      err.status = 404;
      throw err;
    }

    // Validate using the unified single policy
    await this.validatePublishPolicy(gameId);

    const publishedAt = game.published_at || new Date().toISOString();
    await this.gameRepo.updateGame(gameId, { status: 'PUBLISHED', published_at: publishedAt });
    await this.logAudit({ userId: adminId, action: 'PUBLISH_GAME', targetType: 'GAME', targetId: gameId });
    return { success: true };
  }

  async hideGame(gameId: string, adminId = 'admin') {
    const game = await this.gameRepo.findById(gameId);
    if (!game) {
      const err: any = new Error('Game không tồn tại');
      err.status = 404;
      throw err;
    }

    await this.gameRepo.updateGame(gameId, { status: 'HIDDEN' });
    await this.logAudit({ userId: adminId, action: 'HIDE_GAME', targetType: 'GAME', targetId: gameId });
    return { success: true };
  }

  async deleteGame(gameId: string, adminId = 'admin') {
    const game = await this.gameRepo.findById(gameId);
    if (!game) {
      const err: any = new Error('Game không tồn tại');
      err.status = 404;
      throw err;
    }

    // Collect referenced assets of this game before deleting
    const versions = await this.gameRepo.findVersionsByGameId(gameId, false);
    const assetIdsToCheck: string[] = [];
    if (game.cover_asset_id) assetIdsToCheck.push(game.cover_asset_id);
    for (const v of versions) {
      if (v.jar_asset_id) assetIdsToCheck.push(v.jar_asset_id);
      if (v.jad_asset_id) assetIdsToCheck.push(v.jad_asset_id);
    }
    const screenshots = await this.gameRepo.findScreenshotsByGameId(gameId);
    for (const s of screenshots) {
      if (s.asset_id) assetIdsToCheck.push(s.asset_id);
    }

    await this.gameRepo.deleteGame(gameId);

    // Clean up assets that are no longer referenced by anything else
    if (this.storageService) {
      for (const assetId of assetIdsToCheck) {
        try {
          const catalogRef = await this.assetRepo.findCatalogReferences(assetId);
          const userRefs = await this.assetRepo.findUserLibraryReferences(assetId);
          if (!catalogRef && userRefs.length === 0) {
            await this.storageService.deleteAssetById(assetId).catch(() => {});
          }
        } catch {}
      }
    }

    await this.logAudit({ userId: adminId, action: 'DELETE_GAME', targetType: 'GAME', targetId: gameId, details: { name: game.name, slug: game.slug } });
    return { success: true };
  }

  // Version management
  async addVersion(gameId: string, input: CreateVersionInput, adminId = 'admin') {
    const game = await this.gameRepo.findById(gameId);
    if (!game) {
      const err: any = new Error('Game không tồn tại');
      err.status = 404;
      throw err;
    }

    const jarAsset = await this.assetRepo.findById(input.jar_asset_id);
    if (!jarAsset) {
      const err: any = new Error('File JAR asset không tồn tại');
      err.status = 404;
      throw err;
    }
    if (jarAsset.asset_type !== 'JAR') {
      const err: any = new Error('Asset phải thuộc loại JAR');
      err.status = 400;
      throw err;
    }
    if (jarAsset.status !== 'ACTIVE') {
      const err: any = new Error('Asset JAR phải ở trạng thái ACTIVE');
      err.status = 400;
      throw err;
    }
    if (jarAsset.storage_key.startsWith('users/')) {
      const err: any = new Error('Asset JAR thuộc thư viện riêng của người dùng, không thể dùng cho Catalog');
      err.status = 400;
      throw err;
    }

    let jadSha256: string | null = null;
    if (input.jad_asset_id) {
      const jadAsset = await this.assetRepo.findById(input.jad_asset_id);
      if (!jadAsset) {
        const err: any = new Error('File JAD asset không tồn tại');
        err.status = 404;
        throw err;
      }
      if (jadAsset.asset_type !== 'JAD') {
        const err: any = new Error('Asset phải thuộc loại JAD');
        err.status = 400;
        throw err;
      }
      if (jadAsset.status !== 'ACTIVE') {
        const err: any = new Error('Asset JAD phải ở trạng thái ACTIVE');
        err.status = 400;
        throw err;
      }
      if (jadAsset.storage_key.startsWith('users/')) {
        const err: any = new Error('Asset JAD thuộc thư viện riêng của người dùng, không thể dùng cho Catalog');
        err.status = 400;
        throw err;
      }
      jadSha256 = jadAsset.sha256;
    }

    const versionId = generateId();
    await this.gameRepo.createVersion({
      id: versionId,
      game_id: gameId,
      version_name: input.version_name,
      jar_asset_id: input.jar_asset_id,
      jad_asset_id: input.jad_asset_id || null,
      jar_sha256: jarAsset.sha256,
      jad_sha256: jadSha256,
      file_size: jarAsset.file_size,
      status: input.status || 'ACTIVE',
      created_at: new Date().toISOString(),
    });

    await this.logAudit({ userId: adminId, action: 'ADD_VERSION', targetType: 'GAME_VERSION', targetId: versionId, details: { gameId, versionName: input.version_name } });
    return { id: versionId, success: true };
  }

  async deleteVersion(versionId: string, adminId = 'admin') {
    const version = await this.gameRepo.findVersionById(versionId);
    if (!version) {
      const err: any = new Error('Phiên bản game không tồn tại');
      err.status = 404;
      throw err;
    }

    await this.gameRepo.deleteVersion(versionId);
    await this.logAudit({ userId: adminId, action: 'DELETE_VERSION', targetType: 'GAME_VERSION', targetId: versionId });
    return { success: true };
  }

  // Categories
  async createCategory(input: CreateCategoryInput) {
    const existing = await this.categoryRepo.findBySlug(input.slug);
    if (existing) throw new Error('Slug danh mục đã tồn tại');

    const id = generateId();
    const cat = {
      id,
      name: input.name,
      slug: input.slug,
      description: input.description || null,
      sort_order: input.sort_order || 0,
      status: input.status || 'ACTIVE',
    };
    await this.categoryRepo.create(cat);
    return cat;
  }

  async updateCategory(id: string, input: Partial<CreateCategoryInput>) {
    await this.categoryRepo.update(id, input);
    return this.categoryRepo.findById(id);
  }

  async deleteCategory(id: string) {
    await this.categoryRepo.delete(id);
    return { success: true };
  }

  // User Imports
  async getUserImports(page = 1, limit = 50) {
    const offset = (page - 1) * limit;
    const imports = await this.libraryRepo.findAllImportsForAdmin(limit, offset);
    const total = await this.libraryRepo.countImports();

    return {
      imports: imports.map((item) => ({
        ...item,
        jar_url: item.custom_storage_key ? this.storage.getUrl(item.custom_storage_key) : null,
      })),
      total,
      page,
      limit,
    };
  }

  // Assets
  async getAssets(page = 1, limit = 50) {
    const offset = (page - 1) * limit;
    const assets = await this.assetRepo.findAll(limit, offset);
    return assets.map((a) => ({
      ...a,
      url: this.storage.getUrl(a.storage_key),
    }));
  }
}
