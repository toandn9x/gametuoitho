import { LibraryRepository } from '../repositories/libraryRepository';
import { GameRepository } from '../repositories/gameRepository';
import { AssetRepository } from '../repositories/assetRepository';
import { StorageDriver } from '../storage/storage';
import { generateId } from '@gametuoitho/shared-utils';

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

    if (asset.asset_type !== 'JAR') {
      throw new Error('File phải là định dạng JAR');
    }

    const id = generateId();
    await this.libraryRepo.addToLibrary({
      id,
      user_id: userId,
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
    await this.libraryRepo.recordPlay(userId, gameId, userLibraryId);
    return { success: true };
  }

  async getPlayHistory(userId: string, limit = 20) {
    const history = await this.libraryRepo.getPlayHistory(userId, limit);
    return history.map((h) => ({
      ...h,
      cover_url: h.cover_storage_key ? this.storage.getUrl(h.cover_storage_key) : null,
    }));
  }

  async toggleFavorite(userId: string, gameId: string) {
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
