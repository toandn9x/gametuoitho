import { DatabaseClient } from './db';
import { UserLibraryItem, UserGameActivity, PlayHistoryItem, FavoriteGameItem } from '@gametuoitho/shared-types';

export class LibraryRepository {
  constructor(private db: DatabaseClient) {}

  async findUserLibrary(userId: string): Promise<UserLibraryItem[]> {
    const sql = `
      SELECT 
        l.*,
        CASE WHEN g.status = 'PUBLISHED' AND g.visibility = 'PUBLIC' THEN g.name ELSE NULL END as catalog_game_name,
        CASE WHEN g.status = 'PUBLISHED' AND g.visibility = 'PUBLIC' THEN g.slug ELSE NULL END as catalog_game_slug,
        CASE WHEN g.status = 'PUBLISHED' AND g.visibility = 'PUBLIC' THEN a.storage_key ELSE NULL END as cover_storage_key,
        custom.storage_key as custom_storage_key,
        custom.original_filename as custom_original_filename,
        custom.file_size as custom_file_size,
        CASE WHEN l.source_type = 'CATALOG' AND (g.status != 'PUBLISHED' OR g.visibility != 'PUBLIC') THEN 0 ELSE 1 END as is_available
      FROM user_library l
      LEFT JOIN games g ON l.game_id = g.id
      LEFT JOIN game_assets a ON g.cover_asset_id = a.id
      LEFT JOIN game_assets custom ON l.custom_asset_id = custom.id
      WHERE l.user_id = ?
      ORDER BY l.created_at DESC
    `;
    return this.db.query<UserLibraryItem>(sql, [userId]);
  }

  async findUserImports(userId: string): Promise<UserLibraryItem[]> {
    const sql = `
      SELECT 
        l.*,
        custom.storage_key as custom_storage_key,
        custom.original_filename as custom_original_filename,
        custom.file_size as custom_file_size,
        custom.sha256 as custom_sha256
      FROM user_library l
      JOIN game_assets custom ON l.custom_asset_id = custom.id
      WHERE l.user_id = ? AND l.source_type = 'IMPORT'
      ORDER BY l.created_at DESC
    `;
    return this.db.query<UserLibraryItem>(sql, [userId]);
  }

  async findById(id: string): Promise<UserLibraryItem | null> {
    return this.db.queryFirst<UserLibraryItem>('SELECT * FROM user_library WHERE id = ?', [id]);
  }

  async findUserCatalogEntry(userId: string, gameId: string): Promise<UserLibraryItem | null> {
    return this.db.queryFirst<UserLibraryItem>(
      "SELECT * FROM user_library WHERE user_id = ? AND game_id = ? AND source_type = 'CATALOG'",
      [userId, gameId]
    );
  }

  async findUserImportEntry(userId: string, customAssetId: string): Promise<UserLibraryItem | null> {
    return this.db.queryFirst<UserLibraryItem>(
      "SELECT * FROM user_library WHERE user_id = ? AND custom_asset_id = ? AND source_type = 'IMPORT'",
      [userId, customAssetId]
    );
  }

  async addToLibrary(item: {
    id: string;
    user_id: string;
    game_id?: string | null;
    game_version_id?: string | null;
    custom_asset_id?: string | null;
    custom_name: string;
    source_type: 'CATALOG' | 'IMPORT';
  }): Promise<void> {
    await this.db.execute(
      `INSERT INTO user_library (id, user_id, game_id, game_version_id, custom_asset_id, custom_name, source_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        item.id,
        item.user_id,
        item.game_id || null,
        item.game_version_id || null,
        item.custom_asset_id || null,
        item.custom_name,
        item.source_type,
      ]
    );
  }

  async removeFromLibrary(id: string, userId: string): Promise<boolean> {
    const res = await this.db.execute('DELETE FROM user_library WHERE id = ? AND user_id = ?', [id, userId]);
    return res.rowsAffected > 0;
  }

  // Activity / Play History & Favorites
  async recordPlay(userId: string, gameId?: string, userLibraryId?: string): Promise<void> {
    // Check if activity already exists
    const existing = await this.db.queryFirst<UserGameActivity>(
      `SELECT * FROM user_game_activity 
       WHERE user_id = ? AND activity_type = 'PLAY' 
       AND ((game_id IS NOT NULL AND game_id = ?) OR (user_library_id IS NOT NULL AND user_library_id = ?))`,
      [userId, gameId || '', userLibraryId || '']
    );

    if (existing) {
      await this.db.execute(
        `UPDATE user_game_activity 
         SET play_count = play_count + 1, last_played_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`,
        [existing.id]
      );
    } else {
      const id = crypto.randomUUID();
      await this.db.execute(
        `INSERT INTO user_game_activity (id, user_id, game_id, user_library_id, activity_type, last_played_at, play_count)
         VALUES (?, ?, ?, ?, 'PLAY', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)`,
        [id, userId, gameId || null, userLibraryId || null]
      );
    }
  }

  async getPlayHistory(userId: string, limit = 20): Promise<(Omit<PlayHistoryItem, 'cover_url'> & { cover_storage_key: string | null })[]> {
    const sql = `
      WITH history AS (
        SELECT act.id, act.user_id, g.id as game_id,
          CASE WHEN g.id IS NULL THEN l.id ELSE NULL END as user_library_id,
          act.activity_type, act.last_played_at,
          SUM(act.play_count) OVER (
            PARTITION BY COALESCE('game:' || g.id, 'import:' || l.id)
          ) as play_count,
          g.name as game_name, g.slug as game_slug, g.developer,
          cat.name as category_name, a.storage_key as cover_storage_key,
          CASE WHEN g.id IS NULL THEN l.custom_name ELSE NULL END as custom_name,
          act.rowid as activity_order,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE('game:' || g.id, 'import:' || l.id)
            ORDER BY julianday(act.last_played_at) DESC, act.rowid DESC
          ) as history_rank
        FROM user_game_activity act
        LEFT JOIN user_library l ON act.user_library_id = l.id AND l.user_id = act.user_id
        LEFT JOIN games g ON g.id = COALESCE(act.game_id,
          CASE WHEN l.source_type = 'CATALOG' THEN l.game_id END)
          AND g.status = 'PUBLISHED' AND g.visibility = 'PUBLIC'
        LEFT JOIN categories cat ON g.category_id = cat.id
        LEFT JOIN game_assets a ON g.cover_asset_id = a.id AND a.status = 'ACTIVE'
        LEFT JOIN game_assets custom ON l.custom_asset_id = custom.id
          AND custom.owner_user_id = act.user_id AND custom.status = 'ACTIVE'
          AND custom.asset_type = 'JAR'
          AND substr(custom.storage_key, 1, length('users/' || act.user_id || '/')) = 'users/' || act.user_id || '/'
        WHERE act.user_id = ? AND act.activity_type = 'PLAY'
          AND ((act.game_id IS NOT NULL AND act.user_library_id IS NULL)
            OR (act.game_id IS NULL AND l.id IS NOT NULL))
          AND (g.id IS NOT NULL OR (l.source_type = 'IMPORT' AND custom.id IS NOT NULL))
      )
      SELECT id, user_id, game_id, user_library_id, activity_type, last_played_at,
        play_count, game_name, game_slug, developer, category_name, custom_name, cover_storage_key
      FROM history WHERE history_rank = 1
      ORDER BY julianday(last_played_at) DESC, activity_order DESC
      LIMIT ?
    `;
    return this.db.query(sql, [userId, limit]);
  }

  /** Without `desired` the state flips; with it the state is set (safe to repeat, e.g. from a stale tab). */
  async toggleFavorite(userId: string, gameId: string, desired?: boolean): Promise<{ isFavorite: boolean }> {
    const existing = await this.db.queryFirst<UserGameActivity>(
      "SELECT id FROM user_game_activity WHERE user_id = ? AND game_id = ? AND activity_type = 'FAVORITE'",
      [userId, gameId]
    );
    const isFavorite = desired ?? !existing;

    if (!isFavorite) {
      if (existing) {
        await this.db.execute(
          "DELETE FROM user_game_activity WHERE user_id = ? AND game_id = ? AND activity_type = 'FAVORITE'",
          [userId, gameId]
        );
      }
    } else if (!existing) {
      const id = crypto.randomUUID();
      await this.db.execute(
        "INSERT INTO user_game_activity (id, user_id, game_id, activity_type, last_played_at, play_count) VALUES (?, ?, ?, 'FAVORITE', datetime('now'), 1)",
        [id, userId, gameId]
      );
    }
    return { isFavorite };
  }

  async getFavorites(userId: string): Promise<(Omit<FavoriteGameItem, 'cover_url'> & { cover_storage_key: string | null })[]> {
    const sql = `
      SELECT
        act.id,
        g.id as game_id,
        act.last_played_at as favorited_at,
        g.name as game_name,
        g.slug as game_slug,
        g.developer,
        cat.name as category_name,
        a.storage_key as cover_storage_key
      FROM user_game_activity act
      JOIN games g ON act.game_id = g.id AND g.status = 'PUBLISHED' AND g.visibility = 'PUBLIC'
      LEFT JOIN categories cat ON g.category_id = cat.id
      LEFT JOIN game_assets a ON g.cover_asset_id = a.id AND a.status = 'ACTIVE'
      WHERE act.user_id = ? AND act.activity_type = 'FAVORITE'
      ORDER BY julianday(act.last_played_at) DESC, act.rowid DESC
    `;
    return this.db.query(sql, [userId]);
  }

  // Admin query: list all user imports across the platform
  async findAllImportsForAdmin(limit = 50, offset = 0): Promise<any[]> {
    const sql = `
      SELECT 
        l.*,
        u.username as owner_username,
        u.email as owner_email,
        custom.storage_key as custom_storage_key,
        custom.original_filename as custom_original_filename,
        custom.file_size as custom_file_size,
        custom.sha256 as custom_sha256,
        custom.status as asset_status
      FROM user_library l
      JOIN users u ON l.user_id = u.id
      JOIN game_assets custom ON l.custom_asset_id = custom.id
      WHERE l.source_type = 'IMPORT'
      ORDER BY l.created_at DESC
      LIMIT ? OFFSET ?
    `;
    return this.db.query(sql, [limit, offset]);
  }

  async countImports(): Promise<number> {
    const res = await this.db.queryFirst<{ count: number }>(
      "SELECT count(*) as count FROM user_library WHERE source_type = 'IMPORT'"
    );
    return res?.count || 0;
  }
}
