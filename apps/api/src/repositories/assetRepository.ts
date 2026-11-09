import { DatabaseClient } from './db';
import { GameAsset } from '@gametuoitho/shared-types';

export class AssetRepository {
  constructor(private db: DatabaseClient) {}

  async findById(id: string): Promise<GameAsset | null> {
    return this.db.queryFirst<GameAsset>('SELECT * FROM game_assets WHERE id = ?', [id]);
  }

  async findByStorageKey(storageKey: string): Promise<GameAsset | null> {
    return this.db.queryFirst<GameAsset>('SELECT * FROM game_assets WHERE storage_key = ?', [storageKey]);
  }

  async findBySha256(sha256: string): Promise<GameAsset | null> {
    return this.db.queryFirst<GameAsset>("SELECT * FROM game_assets WHERE sha256 = ? AND status = 'ACTIVE'", [sha256]);
  }

  async create(asset: GameAsset): Promise<void> {
    await this.db.execute(
      `INSERT INTO game_assets (id, owner_user_id, asset_type, storage_key, original_filename, mime_type, file_size, sha256, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        asset.id,
        asset.owner_user_id,
        asset.asset_type,
        asset.storage_key,
        asset.original_filename,
        asset.mime_type,
        asset.file_size,
        asset.sha256,
        asset.status || 'ACTIVE',
      ]
    );
  }

  async updateStatus(id: string, status: GameAsset['status']): Promise<void> {
    await this.db.execute('UPDATE game_assets SET status = ? WHERE id = ?', [status, id]);
  }

  async delete(id: string): Promise<void> {
    await this.db.execute('DELETE FROM game_assets WHERE id = ?', [id]);
  }

  async getAllStorageKeys(): Promise<Set<string>> {
    const rows = await this.db.query<{ storage_key: string }>('SELECT storage_key FROM game_assets');
    return new Set(rows.map((r) => r.storage_key));
  }

  async findCatalogReferences(assetId: string): Promise<string | null> {
    // 1. Version JAR
    const jarVer = await this.db.queryFirst<{ game_name: string; version_name: string }>(
      `SELECT g.name as game_name, v.version_name
       FROM game_versions v
       JOIN games g ON v.game_id = g.id
       WHERE v.jar_asset_id = ?
       LIMIT 1`,
      [assetId]
    );
    if (jarVer) {
      return `đang là JAR của game "${jarVer.game_name}" (phiên bản ${jarVer.version_name})`;
    }

    // 2. Version JAD
    const jadVer = await this.db.queryFirst<{ game_name: string; version_name: string }>(
      `SELECT g.name as game_name, v.version_name
       FROM game_versions v
       JOIN games g ON v.game_id = g.id
       WHERE v.jad_asset_id = ?
       LIMIT 1`,
      [assetId]
    );
    if (jadVer) {
      return `đang là JAD của game "${jadVer.game_name}" (phiên bản ${jadVer.version_name})`;
    }

    // 3. Game Cover
    const coverGame = await this.db.queryFirst<{ name: string }>(
      `SELECT name FROM games WHERE cover_asset_id = ? LIMIT 1`,
      [assetId]
    );
    if (coverGame) {
      return `đang là ảnh bìa của game "${coverGame.name}"`;
    }

    // 4. Game Screenshot
    const shotGame = await this.db.queryFirst<{ name: string }>(
      `SELECT g.name FROM game_screenshots s
       JOIN games g ON s.game_id = g.id
       WHERE s.asset_id = ? LIMIT 1`,
      [assetId]
    );
    if (shotGame) {
      return `đang là ảnh chụp màn hình của game "${shotGame.name}"`;
    }

    return null;
  }

  async findUserLibraryReferences(
    assetId: string
  ): Promise<{ userId: string; username: string; email: string; customName: string; libraryId: string }[]> {
    return this.db.query<{ userId: string; username: string; email: string; customName: string; libraryId: string }>(
      `SELECT l.id as libraryId, l.user_id as userId, u.username, u.email, l.custom_name as customName
       FROM user_library l
       LEFT JOIN users u ON l.user_id = u.id
       WHERE l.custom_asset_id = ?`,
      [assetId]
    );
  }

  async deleteUserImportAndLibrary(assetId: string): Promise<void> {
    await this.db.execute(
      `DELETE FROM user_game_activity
       WHERE user_library_id IN (SELECT id FROM user_library WHERE custom_asset_id = ?)`,
      [assetId]
    );
    await this.db.execute('DELETE FROM user_library WHERE custom_asset_id = ?', [assetId]);
    await this.db.execute('DELETE FROM game_assets WHERE id = ?', [assetId]);
  }

  async findAll(limit = 50, offset = 0): Promise<GameAsset[]> {
    return this.db.query<GameAsset>(
      'SELECT * FROM game_assets ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );
  }

  async getTotalStorageBytes(): Promise<number> {
    const res = await this.db.queryFirst<{ total: number }>(
      "SELECT sum(file_size) as total FROM game_assets WHERE status = 'ACTIVE'"
    );
    return res?.total || 0;
  }

  async isCatalogPublicAsset(assetId: string, assetType: string): Promise<boolean> {
    if (assetType === 'JAR') {
      const row = await this.db.queryFirst<{ id: string }>(
        `SELECT g.id FROM game_versions v
         JOIN games g ON v.game_id = g.id
         JOIN game_assets jar ON v.jar_asset_id = jar.id
         LEFT JOIN users jar_owner ON jar.owner_user_id = jar_owner.id
         LEFT JOIN game_assets jad ON v.jad_asset_id = jad.id
         LEFT JOIN users jad_owner ON jad.owner_user_id = jad_owner.id
         WHERE v.jar_asset_id = ?
           AND g.status = 'PUBLISHED'
           AND g.visibility = 'PUBLIC'
           AND v.status = 'ACTIVE'
           AND jar.status = 'ACTIVE'
           AND jar.asset_type = 'JAR'
           AND jar.storage_key NOT LIKE 'users/%'
           AND (jar.owner_user_id IS NULL OR jar_owner.role = 'ADMIN')
           AND (
             v.jad_asset_id IS NULL OR (
               jad.id IS NOT NULL
               AND jad.status = 'ACTIVE'
               AND jad.asset_type = 'JAD'
               AND jad.storage_key NOT LIKE 'users/%'
               AND (jad.owner_user_id IS NULL OR jad_owner.role = 'ADMIN')
             )
           )
         LIMIT 1`,
        [assetId]
      );
      return !!row;
    }
    if (assetType === 'JAD') {
      const row = await this.db.queryFirst<{ id: string }>(
        `SELECT g.id FROM game_versions v
         JOIN games g ON v.game_id = g.id
         JOIN game_assets jar ON v.jar_asset_id = jar.id
         LEFT JOIN users jar_owner ON jar.owner_user_id = jar_owner.id
         JOIN game_assets jad ON v.jad_asset_id = jad.id
         LEFT JOIN users jad_owner ON jad.owner_user_id = jad_owner.id
         WHERE v.jad_asset_id = ?
           AND g.status = 'PUBLISHED'
           AND g.visibility = 'PUBLIC'
           AND v.status = 'ACTIVE'
           AND jar.status = 'ACTIVE'
           AND jar.asset_type = 'JAR'
           AND jar.storage_key NOT LIKE 'users/%'
           AND (jar.owner_user_id IS NULL OR jar_owner.role = 'ADMIN')
           AND jad.status = 'ACTIVE'
           AND jad.asset_type = 'JAD'
           AND jad.storage_key NOT LIKE 'users/%'
           AND (jad.owner_user_id IS NULL OR jad_owner.role = 'ADMIN')
         LIMIT 1`,
        [assetId]
      );
      return !!row;
    }
    if (assetType === 'COVER') {
      const row = await this.db.queryFirst<{ id: string }>(
        `SELECT g.id FROM games g
         JOIN game_assets cov ON g.cover_asset_id = cov.id
         LEFT JOIN users cov_owner ON cov.owner_user_id = cov_owner.id
         WHERE g.cover_asset_id = ?
           AND g.status = 'PUBLISHED'
           AND g.visibility = 'PUBLIC'
           AND cov.status = 'ACTIVE'
           AND cov.asset_type = 'COVER'
           AND cov.storage_key NOT LIKE 'users/%'
           AND (cov.owner_user_id IS NULL OR cov_owner.role = 'ADMIN')
         LIMIT 1`,
        [assetId]
      );
      return !!row;
    }
    if (assetType === 'SCREENSHOT') {
      const row = await this.db.queryFirst<{ id: string }>(
        `SELECT g.id FROM game_screenshots s
         JOIN games g ON s.game_id = g.id
         JOIN game_assets shot ON s.asset_id = shot.id
         LEFT JOIN users shot_owner ON shot.owner_user_id = shot_owner.id
         WHERE s.asset_id = ?
           AND g.status = 'PUBLISHED'
           AND g.visibility = 'PUBLIC'
           AND shot.status = 'ACTIVE'
           AND shot.asset_type = 'SCREENSHOT'
           AND shot.storage_key NOT LIKE 'users/%'
           AND (shot.owner_user_id IS NULL OR shot_owner.role = 'ADMIN')
         LIMIT 1`,
        [assetId]
      );
      return !!row;
    }
    return false;
  }

  async getUserStorageUsage(userId: string): Promise<{ count: number; totalSize: number }> {
    const row = await this.db.queryFirst<{ count: number; total_size: number }>(
      "SELECT COUNT(*) as count, COALESCE(SUM(file_size), 0) as total_size FROM game_assets WHERE owner_user_id = ? AND status = 'ACTIVE'",
      [userId]
    );
    return {
      count: Number(row?.count || 0),
      totalSize: Number(row?.total_size || 0),
    };
  }
}
