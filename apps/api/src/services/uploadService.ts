import { AssetRepository } from '../repositories/assetRepository';
import { UserRepository } from '../repositories/userRepository';
import { StorageDriver } from '../storage/storage';
import { computeSha256, validateJarFile, generateId, verifyJwt } from '@gametuoitho/shared-utils';
import { AssetType, GameAsset } from '@gametuoitho/shared-types';

export class UploadService {
  constructor(
    private assetRepo: AssetRepository,
    private storage: StorageDriver,
    private userRepo?: UserRepository
  ) {}

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

  async checkAssetAccess(
    key: string,
    jwtSecret: string,
    authHeader?: string,
    cookieHeader?: string
  ): Promise<{
    allowed: boolean;
    status: number;
    asset?: GameAsset;
    error?: string;
  }> {
    // 1. Traverse & double encoding defense
    if (!key || typeof key !== 'string') {
      return { allowed: false, status: 404, error: 'Asset Not Found' };
    }
    if (key.includes('%') || key.includes('\0') || key.includes('\\')) {
      return { allowed: false, status: 404, error: 'Asset Not Found' };
    }
    const parts = key.split('/');
    for (const p of parts) {
      if (p === '..' || p === '.') {
        return { allowed: false, status: 404, error: 'Asset Not Found' };
      }
    }

    // 2. Fetch metadata from DB
    const asset = await this.assetRepo.findByStorageKey(key);
    if (!asset) {
      return { allowed: false, status: 404, error: 'Asset Not Found' };
    }

    // 3. Only ACTIVE assets can be served via raw playback endpoint
    if (asset.status !== 'ACTIVE') {
      return { allowed: false, status: 403, error: 'Asset is not active' };
    }

    // 4. Check if public catalog asset
    const isPublic = await this.assetRepo.isCatalogPublicAsset(asset.id, asset.asset_type);
    if (isPublic) {
      return { allowed: true, status: 200, asset };
    }

    // 5. Private asset: require authenticated and active user or admin
    let token: string | undefined;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (cookieHeader) {
      const match = cookieHeader.match(/token=([^;]+)/);
      if (match) token = match[1];
    }

    if (!token) {
      return { allowed: false, status: 401, error: 'Authentication required' };
    }

    const payload = await verifyJwt(token, jwtSecret);
    if (!payload || !payload.userId) {
      return { allowed: false, status: 401, error: 'Invalid token' };
    }

    // Re-verify user and role in database to prevent trust in stale JWT claims
    if (!this.userRepo) {
      return { allowed: false, status: 403, error: 'User repository unavailable' };
    }

    const user = await this.userRepo.findById(payload.userId);
    if (!user || user.status !== 'ACTIVE') {
      return { allowed: false, status: 403, error: 'Account is not active' };
    }

    if (user.role === 'ADMIN') {
      return { allowed: true, status: 200, asset };
    }

    if (asset.owner_user_id && asset.owner_user_id === user.id) {
      return { allowed: true, status: 200, asset };
    }

    return { allowed: false, status: 403, error: 'Forbidden' };
  }
}
