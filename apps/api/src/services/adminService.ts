import { GameRepository } from '../repositories/gameRepository';
import { CategoryRepository } from '../repositories/categoryRepository';
import { AssetRepository } from '../repositories/assetRepository';
import { UserRepository } from '../repositories/userRepository';
import { LibraryRepository } from '../repositories/libraryRepository';
import { StorageDriver } from '../storage/storage';
import { CreateGameInput, UpdateGameInput, CreateCategoryInput, CreateVersionInput } from '@gametuoitho/api-contracts';
import { generateId } from '@gametuoitho/shared-utils';
import { Game } from '@gametuoitho/shared-types';

export class AdminService {
  constructor(
    private gameRepo: GameRepository,
    private categoryRepo: CategoryRepository,
    private assetRepo: AssetRepository,
    private userRepo: UserRepository,
    private libraryRepo: LibraryRepository,
    private storage: StorageDriver
  ) {}

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
    };
  }

  async getAllGames(page = 1, limit = 50) {
    const res = await this.gameRepo.findGames({ page, limit });
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

  async createGame(adminId: string, input: CreateGameInput): Promise<Game> {
    const id = generateId();
    const existing = await this.gameRepo.findBySlug(input.slug);
    if (existing) {
      throw new Error('Slug này đã tồn tại, vui lòng chọn slug khác');
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
      source_type: 'ADMIN',
      created_by: adminId,
      published_at: input.status === 'PUBLISHED' ? new Date().toISOString() : null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await this.gameRepo.createGame(game);
    return game;
  }

  async updateGame(gameId: string, input: UpdateGameInput) {
    const game = await this.gameRepo.findById(gameId);
    if (!game) throw new Error('Game không tồn tại');

    if (input.slug && input.slug !== game.slug) {
      const existing = await this.gameRepo.findBySlug(input.slug);
      if (existing) throw new Error('Slug này đã được sử dụng');
    }

    await this.gameRepo.updateGame(gameId, input);
    return this.gameRepo.findById(gameId);
  }

  async publishGame(gameId: string) {
    const game = await this.gameRepo.findById(gameId);
    if (!game) throw new Error('Game không tồn tại');

    // Verify game has at least one active version
    const versions = await this.gameRepo.findVersionsByGameId(gameId, true);
    if (versions.length === 0) {
      throw new Error('Không thể xuất bản game khi chưa có phiên bản file JAR hoạt động');
    }

    await this.gameRepo.updateGame(gameId, { status: 'PUBLISHED' });
    return { success: true };
  }

  async hideGame(gameId: string) {
    await this.gameRepo.updateGame(gameId, { status: 'HIDDEN' });
    return { success: true };
  }

  async deleteGame(gameId: string) {
    await this.gameRepo.deleteGame(gameId);
    return { success: true };
  }

  // Version management
  async addVersion(gameId: string, input: CreateVersionInput) {
    const game = await this.gameRepo.findById(gameId);
    if (!game) throw new Error('Game không tồn tại');

    const jarAsset = await this.assetRepo.findById(input.jar_asset_id);
    if (!jarAsset) throw new Error('File JAR asset không tồn tại');

    const versionId = generateId();
    await this.gameRepo.createVersion({
      id: versionId,
      game_id: gameId,
      version_name: input.version_name,
      jar_asset_id: input.jar_asset_id,
      jad_asset_id: input.jad_asset_id || null,
      jar_sha256: jarAsset.sha256,
      jad_sha256: null,
      file_size: jarAsset.file_size,
      status: input.status || 'ACTIVE',
      created_at: new Date().toISOString(),
    });

    return { id: versionId, success: true };
  }

  async deleteVersion(versionId: string) {
    await this.gameRepo.deleteVersion(versionId);
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
