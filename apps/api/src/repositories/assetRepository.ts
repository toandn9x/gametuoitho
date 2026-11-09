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
}
