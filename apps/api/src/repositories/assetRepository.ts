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
}
