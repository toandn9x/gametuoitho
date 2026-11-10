import { AssetRepository } from '../repositories/assetRepository';
import { StorageDriver, StoredObjectInfo } from '../storage/storage';

export interface StorageAnalysisResult {
  totalDiskBytes: number;
  totalDiskFormatted: string;
  totalAssetsInDb: number;
  activeAssetsCount: number;
  orphanCount: number;
  orphanBytes: number;
  orphanFormatted: string;
  orphansList: { key: string; size: number; sizeFormatted: string }[];
  deletedAssetsCount: number;
  deletedAssetsBytes: number;
  deletedAssetsFormatted: string;
  breakdown: {
    jarBytes: number;
    coverBytes: number;
    userImportBytes: number;
    otherBytes: number;
  };
}

export interface AssetDeleteResult {
  id: string;
  ok: boolean;
  status?: number;
  reason?: string;
  affectedUsers?: { userId: string; username: string; email: string; customName: string }[];
}

export interface CleanupStorageOptions {
  cleanOrphans?: boolean;
  purgeDeleted?: boolean;
  purgeQuarantined?: boolean;
  safetyWindowMs?: number;
}

export interface CleanupStorageResult {
  freedBytes: number;
  freedFormatted: string;
  deletedFilesCount: number;
  deletedItems: { key: string; size: number }[];
  skippedItems: { key: string; reason: string }[];
  message: string;
}

export class StorageService {
  constructor(
    private assetRepo: AssetRepository,
    private storage: StorageDriver
  ) {}

  /** Stored files, via the storage driver (local uploads folder or Cloudflare R2). */
  private async listStoredFiles(): Promise<StoredObjectInfo[]> {
    return this.storage.list ? this.storage.list() : [];
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  async analyzeStorage(): Promise<StorageAnalysisResult> {
    const diskFiles = await this.listStoredFiles();
    const allDbKeys = await this.assetRepo.getAllStorageKeys();
    const dbAssets = await this.assetRepo.findAll(10000, 0);

    const dbKeyMap = new Map<string, any>();
    for (const a of dbAssets) {
      dbKeyMap.set(a.storage_key, a);
    }

    let totalDiskBytes = 0;
    let orphanCount = 0;
    let orphanBytes = 0;
    const orphansList: { key: string; size: number; sizeFormatted: string }[] = [];

    let jarBytes = 0;
    let coverBytes = 0;
    let userImportBytes = 0;
    let otherBytes = 0;

    for (const file of diskFiles) {
      totalDiskBytes += file.size;

      if (!allDbKeys.has(file.key)) {
        orphanCount++;
        orphanBytes += file.size;
        orphansList.push({
          key: file.key,
          size: file.size,
          sizeFormatted: this.formatBytes(file.size),
        });
      } else {
        const dbAsset = dbKeyMap.get(file.key);
        if (dbAsset) {
          if (dbAsset.asset_type === 'JAR') {
            jarBytes += file.size;
          } else if (dbAsset.asset_type === 'COVER') {
            coverBytes += file.size;
          } else {
            otherBytes += file.size;
          }
        }

        if (file.key.startsWith('users/')) {
          userImportBytes += file.size;
        }
      }
    }

    let deletedAssetsCount = 0;
    let deletedAssetsBytes = 0;
    for (const a of dbAssets) {
      if (a.status === 'DELETED' || a.status === 'QUARANTINED') {
        deletedAssetsCount++;
        deletedAssetsBytes += a.file_size || 0;
      }
    }

    return {
      totalDiskBytes,
      totalDiskFormatted: this.formatBytes(totalDiskBytes),
      totalAssetsInDb: dbAssets.length,
      activeAssetsCount: dbAssets.filter((a) => a.status === 'ACTIVE').length,
      orphanCount,
      orphanBytes,
      orphanFormatted: this.formatBytes(orphanBytes),
      orphansList: orphansList.slice(0, 50), // top 50
      deletedAssetsCount,
      deletedAssetsBytes,
      deletedAssetsFormatted: this.formatBytes(deletedAssetsBytes),
      breakdown: {
        jarBytes,
        coverBytes,
        userImportBytes,
        otherBytes,
      },
    };
  }

  async cleanupStorage(options: CleanupStorageOptions = {}): Promise<CleanupStorageResult> {
    let freedBytes = 0;
    let deletedFilesCount = 0;
    const deletedItems: { key: string; size: number }[] = [];
    const skippedItems: { key: string; reason: string }[] = [];

    const safetyWindowMs = options.safetyWindowMs ?? 15 * 60 * 1000;
    const now = Date.now();

    const diskFiles = await this.listStoredFiles();
    const allDbKeys = await this.assetRepo.getAllStorageKeys();

    // 1. Clean orphans
    if (options.cleanOrphans) {
      for (const file of diskFiles) {
        if (!allDbKeys.has(file.key)) {
          if (now - file.mtimeMs < safetyWindowMs) {
            skippedItems.push({
              key: file.key,
              reason: 'Tệp mới tạo trong khoảng an toàn 15 phút',
            });
            continue;
          }

          try {
            await this.storage.delete(file.key);
            freedBytes += file.size;
            deletedFilesCount++;
            deletedItems.push({ key: file.key, size: file.size });
          } catch (err: any) {
            console.warn(`[StorageService] Failed to delete orphan file ${file.key}:`, err);
          }
        }
      }
    }

    // 2. Purge deleted/quarantined assets
    if (options.purgeDeleted) {
      const dbAssets = await this.assetRepo.findAll(10000, 0);
      for (const a of dbAssets) {
        const shouldPurge =
          a.status === 'DELETED' || (options.purgeQuarantined && a.status === 'QUARANTINED');
        if (shouldPurge) {
          // Never purge an asset that is still referenced in Catalog!
          const catalogRef = await this.assetRepo.findCatalogReferences(a.id);
          if (catalogRef) {
            skippedItems.push({
              key: a.storage_key,
              reason: `Asset đang được tham chiếu (${catalogRef})`,
            });
            continue;
          }

          try {
            await this.assetRepo.delete(a.id);
            await this.storage.delete(a.storage_key);
            freedBytes += a.file_size || 0;
            deletedFilesCount++;
            deletedItems.push({ key: a.storage_key, size: a.file_size || 0 });
          } catch (err: any) {
            console.warn(`[StorageService] Failed to purge asset ${a.id}:`, err);
          }
        }
      }
    }

    // Clean up empty directories in uploads (local disk only)
    await this.storage.pruneEmptyDirs?.();

    return {
      freedBytes,
      freedFormatted: this.formatBytes(freedBytes),
      deletedFilesCount,
      deletedItems,
      skippedItems,
      message: `Đã dọn dẹp ${deletedFilesCount} tệp tin, giải phóng ${this.formatBytes(freedBytes)} dung lượng lưu trữ!`,
    };
  }

  async deleteAssetById(assetId: string): Promise<AssetDeleteResult> {
    const asset = await this.assetRepo.findById(assetId);
    if (!asset) {
      const err = new Error('Asset không tồn tại');
      (err as any).status = 404;
      (err as any).code = 'NOT_FOUND';
      throw err;
    }

    // 1. Check catalog references: JAR, JAD, Cover, Screenshot
    const catalogRef = await this.assetRepo.findCatalogReferences(assetId);
    if (catalogRef) {
      const err = new Error(`Asset không thể xóa vì ${catalogRef}`);
      (err as any).status = 409;
      (err as any).code = 'CONFLICT';
      (err as any).reason = `Asset không thể xóa vì ${catalogRef}`;
      throw err;
    }

    // 2. Check user library references (User custom import)
    const userRefs = await this.assetRepo.findUserLibraryReferences(assetId);
    if (userRefs.length > 0) {
      // Delete user library and asset records first in DB
      await this.assetRepo.deleteUserImportAndLibrary(assetId);
      // Delete physical file on storage afterwards
      try {
        await this.storage.delete(asset.storage_key);
      } catch (fileErr: any) {
        console.error(`[StorageService] Error deleting storage key ${asset.storage_key} after DB delete:`, fileErr);
        throw new Error(`Đã xóa bản ghi cơ sở dữ liệu nhưng xóa tệp vật lý thất bại: ${fileErr?.message}`);
      }
      return {
        id: assetId,
        ok: true,
        affectedUsers: userRefs.map((u) => ({
          userId: u.userId,
          username: u.username,
          email: u.email,
          customName: u.customName,
        })),
      };
    }

    // 3. Unreferenced asset: delete DB record first, then delete file
    await this.assetRepo.delete(assetId);
    try {
      await this.storage.delete(asset.storage_key);
    } catch (fileErr: any) {
      console.error(`[StorageService] Error deleting storage key ${asset.storage_key} after DB delete:`, fileErr);
      throw new Error(`Đã xóa bản ghi cơ sở dữ liệu nhưng xóa tệp vật lý thất bại: ${fileErr?.message}`);
    }

    return {
      id: assetId,
      ok: true,
    };
  }

  async bulkDeleteAssets(ids: string[]): Promise<{
    results: { id: string; ok: boolean; status: number; reason?: string }[];
  }> {
    const results: { id: string; ok: boolean; status: number; reason?: string }[] = [];

    for (const id of ids) {
      try {
        await this.deleteAssetById(id);
        results.push({ id, ok: true, status: 200 });
      } catch (err: any) {
        results.push({
          id,
          ok: false,
          status: err.status || 400,
          reason: err.message || 'Lỗi xóa asset',
        });
      }
    }

    return { results };
  }
}
