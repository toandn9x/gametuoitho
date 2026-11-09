import { AssetRepository } from '../repositories/assetRepository';
import { UserRepository } from '../repositories/userRepository';
import { UploadJobRepository } from '../repositories/uploadJobRepository';
import { StorageDriver } from '../storage/storage';
import {
  computeSha256,
  validateJarFile,
  validateJadFile,
  detectImageFormat,
  generateId,
  verifyJwt,
} from '@gametuoitho/shared-utils';
import { AssetType, GameAsset } from '@gametuoitho/shared-types';
import { extractToken } from '../middleware/auth';

export class UploadError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
  }
}

export class UploadService {
  constructor(
    private assetRepo: AssetRepository,
    private storage: StorageDriver,
    private userRepo?: UserRepository,
    private uploadJobRepo?: UploadJobRepository
  ) {}

  async uploadFile(params: {
    userId: string;
    userRole?: string;
    fileBuffer: ArrayBuffer | Uint8Array;
    originalFilename: string;
    assetType: AssetType;
    mimeType?: string;
    gameId?: string;
    versionId?: string;
  }): Promise<GameAsset> {
    const bytes = params.fileBuffer instanceof Uint8Array ? params.fileBuffer : new Uint8Array(params.fileBuffer);
    const assetId = generateId();
    const jobId = generateId();
    const isAdmin = params.userRole === 'ADMIN';

    // 1. Quota & Rate Limit for regular users
    if (!isAdmin) {
      if (this.uploadJobRepo) {
        const recentCount = await this.uploadJobRepo.countRecentUploadsByUser(params.userId, 60);
        if (recentCount >= 10) {
          throw new UploadError('Tần suất tải lên quá nhanh (tối đa 10 file/phút). Vui lòng thử lại sau.', 429);
        }
      }

      const usage = await this.assetRepo.getUserStorageUsage(params.userId);
      const USER_MAX_QUOTA = 200 * 1024 * 1024; // 200MB
      const USER_MAX_FILES = 50;

      if (usage.totalSize + bytes.length > USER_MAX_QUOTA || usage.count >= USER_MAX_FILES) {
        throw new UploadError('Dung lượng lưu trữ của bạn đã vượt quá giới hạn 200MB hoặc 50 files cho phép', 413);
      }
    }

    // 2. Validate size limit (max 50MB overall)
    const MAX_SIZE = 50 * 1024 * 1024;
    if (bytes.length > MAX_SIZE) {
      if (this.uploadJobRepo) {
        const sha256 = await computeSha256(bytes);
        await this.assetRepo.create({
          id: assetId,
          owner_user_id: params.userId,
          asset_type: params.assetType,
          storage_key: `quarantined/${assetId}`,
          original_filename: params.originalFilename,
          mime_type: 'application/octet-stream',
          file_size: bytes.length,
          sha256,
          status: 'QUARANTINED',
          created_at: new Date().toISOString(),
        });
        await this.uploadJobRepo.create({
          id: jobId,
          user_id: params.userId,
          asset_id: assetId,
          status: 'FAILED',
          error_message: 'Dung lượng file vượt quá giới hạn 50MB cho phép',
        });
      }
      throw new UploadError('Dung lượng file vượt quá giới hạn 50MB cho phép', 413);
    }

    let detectedMime = 'application/octet-stream';
    let detectedExt = 'bin';

    // 3. Server determines file type & deep validation
    if (params.assetType === 'JAR') {
      const jarCheck = await validateJarFile(bytes);
      if (!jarCheck.valid) {
        if (this.uploadJobRepo) {
          const sha256 = await computeSha256(bytes);
          await this.assetRepo.create({
            id: assetId,
            owner_user_id: params.userId,
            asset_type: 'JAR',
            storage_key: `quarantined/${assetId}`,
            original_filename: params.originalFilename,
            mime_type: 'application/java-archive',
            file_size: bytes.length,
            sha256,
            status: 'QUARANTINED',
            created_at: new Date().toISOString(),
          });
          await this.uploadJobRepo.create({
            id: jobId,
            user_id: params.userId,
            asset_id: assetId,
            status: 'FAILED',
            error_message: jarCheck.error || 'File JAR không hợp lệ',
          });
        }
        throw new UploadError(jarCheck.error || 'File JAR không hợp lệ', 400);
      }
      detectedMime = 'application/java-archive';
      detectedExt = 'jar';
    } else if (params.assetType === 'JAD') {
      const jadCheck = validateJadFile(bytes);
      if (!jadCheck.valid) {
        if (this.uploadJobRepo) {
          const sha256 = await computeSha256(bytes);
          await this.assetRepo.create({
            id: assetId,
            owner_user_id: params.userId,
            asset_type: 'JAD',
            storage_key: `quarantined/${assetId}`,
            original_filename: params.originalFilename,
            mime_type: 'text/vnd.sun.j2me.app-descriptor',
            file_size: bytes.length,
            sha256,
            status: 'QUARANTINED',
            created_at: new Date().toISOString(),
          });
          await this.uploadJobRepo.create({
            id: jobId,
            user_id: params.userId,
            asset_id: assetId,
            status: 'FAILED',
            error_message: jadCheck.error || 'File JAD không hợp lệ',
          });
        }
        throw new UploadError(jadCheck.error || 'File JAD không hợp lệ', 400);
      }
      detectedMime = 'text/vnd.sun.j2me.app-descriptor';
      detectedExt = 'jad';
    } else if (params.assetType === 'COVER' || params.assetType === 'SCREENSHOT') {
      const imgCheck = detectImageFormat(bytes);
      if (!imgCheck.valid) {
        if (this.uploadJobRepo) {
          const sha256 = await computeSha256(bytes);
          await this.assetRepo.create({
            id: assetId,
            owner_user_id: params.userId,
            asset_type: params.assetType,
            storage_key: `quarantined/${assetId}`,
            original_filename: params.originalFilename,
            mime_type: 'application/octet-stream',
            file_size: bytes.length,
            sha256,
            status: 'QUARANTINED',
            created_at: new Date().toISOString(),
          });
          await this.uploadJobRepo.create({
            id: jobId,
            user_id: params.userId,
            asset_id: assetId,
            status: 'FAILED',
            error_message: imgCheck.error || 'Định dạng ảnh không hợp lệ',
          });
        }
        throw new UploadError(imgCheck.error || 'Định dạng ảnh không hợp lệ (chỉ hỗ trợ PNG, JPEG, WebP, GIF)', 400);
      }
      detectedMime = imgCheck.mimeType || 'image/png';
      detectedExt = imgCheck.ext || 'png';
    } else {
      throw new UploadError(`Loại asset "${params.assetType}" không được hỗ trợ`, 400);
    }

    const sha256 = await computeSha256(bytes);

    // 4. Determine storage key strictly according to PLAN.md Section 4.4 (Server-controlled extensions)
    let storageKey: string;
    if (params.gameId) {
      if (params.assetType === 'JAR') {
        const vId = params.versionId || generateId();
        storageKey = `games/${params.gameId}/versions/${vId}/game.jar`;
      } else if (params.assetType === 'JAD') {
        const vId = params.versionId || generateId();
        storageKey = `games/${params.gameId}/versions/${vId}/game.jad`;
      } else if (params.assetType === 'COVER') {
        storageKey = `games/${params.gameId}/covers/cover.${detectedExt}`;
      } else {
        storageKey = `games/${params.gameId}/screenshots/${assetId}.${detectedExt}`;
      }
    } else {
      // User import
      storageKey = `users/${params.userId}/imports/${assetId}/game.${detectedExt}`;
    }

    // 5. Track upload job -> PROCESSING
    if (this.uploadJobRepo) {
      // Create asset placeholder or job
      await this.assetRepo.create({
        id: assetId,
        owner_user_id: params.userId,
        asset_type: params.assetType,
        storage_key: storageKey,
        original_filename: params.originalFilename,
        mime_type: detectedMime,
        file_size: bytes.length,
        sha256,
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
      });
      await this.uploadJobRepo.create({
        id: jobId,
        user_id: params.userId,
        asset_id: assetId,
        status: 'PROCESSING',
      });
    }

    try {
      // Save to storage driver
      await this.storage.put(storageKey, bytes, detectedMime);

      if (!this.uploadJobRepo) {
        await this.assetRepo.create({
          id: assetId,
          owner_user_id: params.userId,
          asset_type: params.assetType,
          storage_key: storageKey,
          original_filename: params.originalFilename,
          mime_type: detectedMime,
          file_size: bytes.length,
          sha256,
          status: 'ACTIVE',
          created_at: new Date().toISOString(),
        });
      } else {
        await this.uploadJobRepo.updateStatus(jobId, 'COMPLETED');
      }

      const asset: GameAsset = {
        id: assetId,
        owner_user_id: params.userId,
        asset_type: params.assetType,
        storage_key: storageKey,
        original_filename: params.originalFilename,
        mime_type: detectedMime,
        file_size: bytes.length,
        sha256,
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
      };

      return {
        ...asset,
        url: this.storage.getUrl(storageKey),
      };
    } catch (err: any) {
      if (this.uploadJobRepo) {
        await this.uploadJobRepo.updateStatus(jobId, 'FAILED', err.message);
        await this.assetRepo.updateStatus(assetId, 'QUARANTINED');
      }
      await this.storage.delete(storageKey).catch(() => {});
      throw err;
    }
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
    const token = extractToken(authHeader, cookieHeader);

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

    const tokenVer = payload.tokenVersion ?? 0;
    const dbVer = user.token_version ?? 0;
    if (tokenVer !== dbVer) {
      return { allowed: false, status: 401, error: 'Token has been revoked' };
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
