import { LibraryRepository } from '../repositories/libraryRepository';
import { GameRepository } from '../repositories/gameRepository';
import { AssetRepository } from '../repositories/assetRepository';
import { StorageDriver } from '../storage/storage';
import { generateId } from '@gametuoitho/shared-utils';
import { PlayHistoryItem } from '@gametuoitho/shared-types';

export class LibraryService {
  constructor(
    private libraryRepo: LibraryRepository,
    private gameRepo: GameRepository,
    private assetRepo: AssetRepository,
    private storage: StorageDriver
  ) {}

  async getUserLibrary(userId: string) {
    const items = await this.libraryRepo.findUserLibrary(userId);
    return items.map((item: any) => ({
      ...item,
      cover_url: item.cover_storage_key ? this.storage.getUrl(item.cover_storage_key) : null,
      custom_jar_url: item.custom_storage_key ? this.storage.getUrl(item.custom_storage_key) : null,
    }));
  }

  async getUserImports(userId: string) {
    const items = await this.libraryRepo.findUserImports(userId);
    return items.map((item: any) => ({
      ...item,
      jar_url: item.custom_storage_key ? this.storage.getUrl(item.custom_storage_key) : null,
    }));
  }

  async addCatalogGameToLibrary(userId: string, gameId: string, gameVersionId?: string) {
    const game = await this.gameRepo.findById(gameId);
    if (!game) throw new Error('Game không tồn tại');

    // Security (R06-B): Catalog item only accepts PUBLISHED + PUBLIC games
    if (game.status !== 'PUBLISHED' || game.visibility !== 'PUBLIC') {
      throw new Error('Game này chưa được xuất bản hoặc không khả dụng công khai');
    }

    // Verify version if provided
    if (gameVersionId) {
      const versions = await this.gameRepo.findVersionsByGameId(gameId);
      const version = versions.find((v) => v.id === gameVersionId && v.status === 'ACTIVE');
      if (!version) {
        throw new Error('Phiên bản game không hợp lệ hoặc không thuộc game này');
      }
    }

    // Check if already in library
    const existing = await this.libraryRepo.findUserCatalogEntry(userId, gameId);
    if (existing) {
      throw new Error('Game này đã có trong thư viện của bạn');
    }

    const id = generateId();
    await this.libraryRepo.addToLibrary({
      id,
      user_id: userId,
      game_id: gameId,
      game_version_id: gameVersionId || null,
      custom_asset_id: null,
      custom_name: game.name,
      source_type: 'CATALOG',
    });

    return { id, success: true };
  }

  async addImportToLibrary(userId: string, customName: string, jarAssetId: string) {
    const asset = await this.assetRepo.findById(jarAssetId);
    if (!asset) throw new Error('Asset không tồn tại');

    // Verify ownership
    if (asset.owner_user_id !== userId) {
      throw new Error('Bạn không có quyền sở hữu file này');
    }

    if (asset.status !== 'ACTIVE') {
      throw new Error('Asset không ở trạng thái khả dụng');
    }

    if (asset.asset_type !== 'JAR') {
      throw new Error('File phải là định dạng JAR');
    }

    if (!asset.storage_key.startsWith(`users/${userId}/`)) {
      throw new Error('Đường dẫn lưu trữ file không hợp lệ');
    }

    // Anti-duplication (R06-B / Plan 4.3): Each import asset can only be added once
    const existing = await this.libraryRepo.findUserImportEntry(userId, jarAssetId);
    if (existing) {
      throw new Error('Asset này đã có trong thư viện của bạn');
    }

    const id = generateId();
    await this.libraryRepo.addToLibrary({
      id,
      user_id: userId,
      game_id: null,
      game_version_id: null,
      custom_asset_id: jarAssetId,
      custom_name: customName,
      source_type: 'IMPORT',
    });

    return { id, success: true };
  }

  async removeFromLibrary(userId: string, libraryItemId: string) {
    const item = await this.libraryRepo.findById(libraryItemId);
    if (!item) throw new Error('Mục thư viện không tồn tại');

    if (item.user_id !== userId) {
      throw new Error('Bạn không có quyền xóa mục này');
    }

    const deleted = await this.libraryRepo.removeFromLibrary(libraryItemId, userId);
    return { success: deleted };
  }

  async recordPlay(userId: string, gameId?: string, userLibraryId?: string) {
    if (Boolean(gameId) === Boolean(userLibraryId)) {
      throw new Error('Cần cung cấp một game hoặc một mục thư viện');
    }

    if (userLibraryId) {
      const item = await this.libraryRepo.findById(userLibraryId);
      if (!item || item.user_id !== userId) {
        throw new Error('Mục thư viện không tồn tại hoặc không thuộc quyền sở hữu của bạn');
      }
      if (item.source_type === 'CATALOG') {
        // The same catalog game has one history entry, including launches from the library.
        gameId = item.game_id || undefined;
        userLibraryId = undefined;
        if (!gameId) throw new Error('Game không còn khả dụng');
      } else {
        const asset = item.custom_asset_id ? await this.assetRepo.findById(item.custom_asset_id) : null;
        if (!asset || asset.owner_user_id !== userId || asset.status !== 'ACTIVE' ||
            asset.asset_type !== 'JAR' || !asset.storage_key.startsWith(`users/${userId}/`)) {
          throw new Error('File game riêng tư không còn khả dụng');
        }
      }
    }

    // Security (R06-B): gameId must be a public published game
    if (gameId) {
      const game = await this.gameRepo.findById(gameId);
      if (!game || game.status !== 'PUBLISHED' || game.visibility !== 'PUBLIC') {
        throw new Error('Game không tồn tại hoặc chưa được xuất bản công khai');
      }
    }

    await this.libraryRepo.recordPlay(userId, gameId, userLibraryId);
    return { success: true };
  }

  async getPlayHistory(userId: string, limit = 20): Promise<PlayHistoryItem[]> {
    const history = await this.libraryRepo.getPlayHistory(userId, limit);
    return history.map(({ cover_storage_key, ...item }) => ({
      ...item,
      cover_url: cover_storage_key ? this.storage.getUrl(cover_storage_key) : null,
    }));
  }

  async toggleFavorite(userId: string, gameId: string) {
    // Security (R06-B): Only public published games can be favorited
    const game = await this.gameRepo.findById(gameId);
    if (!game || game.status !== 'PUBLISHED' || game.visibility !== 'PUBLIC') {
      throw new Error('Game không tồn tại hoặc chưa được xuất bản công khai');
    }

    return this.libraryRepo.toggleFavorite(userId, gameId);
  }

  async getFavorites(userId: string) {
    const favs = await this.libraryRepo.getFavorites(userId);
    return favs.map((f) => ({
      ...f,
      cover_url: f.cover_storage_key ? this.storage.getUrl(f.cover_storage_key) : null,
    }));
  }
}
