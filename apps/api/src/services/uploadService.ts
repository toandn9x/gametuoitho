import { AssetRepository } from '../repositories/assetRepository';
import { StorageDriver } from '../storage/storage';
import { computeSha256, validateJarFile, generateId } from '@gametuoitho/shared-utils';
import { AssetType, GameAsset } from '@gametuoitho/shared-types';

export class UploadService {
  constructor(private assetRepo: AssetRepository, private storage: StorageDriver) {}

  async uploadFile(params: {
    userId: string;
    fileBuffer: ArrayBuffer | Uint8Array;
    originalFilename: string;
    assetType: AssetType;
    mimeType: string;
    gameId?: string;
    versionId?: string;
  }): Promise<GameAsset> {
    const bytes = params.fileBuffer instanceof Uint8Array ? params.fileBuffer : new Uint8Array(params.fileBuffer);

    // Validate JAR files
    if (params.assetType === 'JAR') {
      const jarCheck = validateJarFile(bytes);
      if (!jarCheck.valid) {
        throw new Error(jarCheck.error || 'File JAR không hợp lệ');
      }
    }

    // Validate size limit (max 50MB)
    const MAX_SIZE = 50 * 1024 * 1024;
    if (bytes.length > MAX_SIZE) {
      throw new Error('Dung lượng file vượt quá giới hạn 50MB cho phép');
    }

    const sha256 = await computeSha256(bytes);
    const assetId = generateId();

    // Determine storage key strictly according to PLAN.md Section 4.4
    let storageKey: string;
    const ext = params.originalFilename.split('.').pop()?.toLowerCase() || '';

    if (params.gameId) {
      if (params.assetType === 'JAR') {
        const vId = params.versionId || generateId();
        storageKey = `games/${params.gameId}/versions/${vId}/game.jar`;
      } else if (params.assetType === 'JAD') {
        const vId = params.versionId || generateId();
        storageKey = `games/${params.gameId}/versions/${vId}/game.jad`;
      } else if (params.assetType === 'COVER') {
        storageKey = `games/${params.gameId}/covers/cover.${ext || 'webp'}`;
      } else {
        storageKey = `games/${params.gameId}/screenshots/${assetId}.${ext || 'webp'}`;
      }
    } else {
      // User import
      storageKey = `users/${params.userId}/imports/${assetId}/game.${ext || (params.assetType === 'JAR' ? 'jar' : 'bin')}`;
    }

    // Save to storage
    await this.storage.put(storageKey, bytes, params.mimeType);

    // Save to database
    const asset: GameAsset = {
      id: assetId,
      owner_user_id: params.userId,
      asset_type: params.assetType,
      storage_key: storageKey,
      original_filename: params.originalFilename,
      mime_type: params.mimeType,
      file_size: bytes.length,
      sha256,
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
    };

    await this.assetRepo.create(asset);

    return {
      ...asset,
      url: this.storage.getUrl(storageKey),
    };
  }

  async getFile(storageKey: string) {
    return this.storage.get(storageKey);
  }
}
