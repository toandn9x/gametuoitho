import { DatabaseClient } from './db';
import { Game, GameVersion, GameScreenshot } from '@gametuoitho/shared-types';

export interface GameFilter {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: string;
  categorySlug?: string;
  featured?: boolean;
  status?: Game['status'];
  visibility?: Game['visibility'];
  sort?: 'newest' | 'popular' | 'name';
}

export class GameRepository {
  constructor(private db: DatabaseClient) {}

  private normalizeGame(game: Game): Game {
    return { ...game, is_featured: Boolean(game.is_featured) };
  }

  async findGames(filter: GameFilter): Promise<{ games: Game[]; total: number }> {
    const page = Math.max(1, filter.page || 1);
    const limit = Math.min(100, Math.max(1, filter.limit || 20));
    const offset = (page - 1) * limit;

    const whereClauses: string[] = [];
    const params: any[] = [];

    if (filter.status) {
      whereClauses.push('g.status = ?');
      params.push(filter.status);
    }
    if (filter.visibility) {
      whereClauses.push('g.visibility = ?');
      params.push(filter.visibility);
    }
    if (filter.featured !== undefined) {
      whereClauses.push('g.is_featured = ?');
      params.push(filter.featured ? 1 : 0);
    }
    if (filter.categoryId) {
      whereClauses.push('g.category_id = ?');
      params.push(filter.categoryId);
    }
    if (filter.categorySlug) {
      whereClauses.push('c.slug = ?');
      params.push(filter.categorySlug);
    }
    if (filter.search) {
      whereClauses.push('(g.name LIKE ? OR g.description LIKE ? OR g.developer LIKE ?)');
      const term = `%${filter.search}%`;
      params.push(term, term, term);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Count query
    const countSql = `
      SELECT count(*) as total 
      FROM games g 
      LEFT JOIN categories c ON g.category_id = c.id
      ${whereSql}
    `;
    const countRes = await this.db.queryFirst<{ total: number }>(countSql, params);
    const total = countRes?.total || 0;

    // Sorting
    let orderSql = 'ORDER BY g.created_at DESC';
    if (filter.sort === 'name') {
      orderSql = 'ORDER BY g.name ASC';
    } else if (filter.sort === 'popular') {
      orderSql = 'ORDER BY g.published_at DESC';
    }

    // Query games with category and cover details
    const selectSql = `
      SELECT 
        g.*,
        c.name as category_name,
        c.slug as category_slug,
        a.storage_key as cover_storage_key
      FROM games g
      LEFT JOIN categories c ON g.category_id = c.id
      LEFT JOIN (
        SELECT ca.id, ca.storage_key
        FROM game_assets ca
        LEFT JOIN users co ON ca.owner_user_id = co.id
        WHERE ca.status = 'ACTIVE'
          AND ca.asset_type = 'COVER'
          AND ca.storage_key NOT LIKE 'users/%'
          AND (ca.owner_user_id IS NULL OR co.role = 'ADMIN')
      ) a ON g.cover_asset_id = a.id
      ${whereSql}
      ${orderSql}
      LIMIT ? OFFSET ?
    `;

    const games = await this.db.query<Game>(selectSql, [...params, limit, offset]);

    return { games: games.map(game => this.normalizeGame(game)), total };
  }

  async findBySlug(slug: string): Promise<Game | null> {
    const sql = `
      SELECT 
        g.*,
        c.name as category_name,
        c.slug as category_slug,
        a.storage_key as cover_storage_key
      FROM games g
      LEFT JOIN categories c ON g.category_id = c.id
      LEFT JOIN (
        SELECT ca.id, ca.storage_key
        FROM game_assets ca
        LEFT JOIN users co ON ca.owner_user_id = co.id
        WHERE ca.status = 'ACTIVE'
          AND ca.asset_type = 'COVER'
          AND ca.storage_key NOT LIKE 'users/%'
          AND (ca.owner_user_id IS NULL OR co.role = 'ADMIN')
      ) a ON g.cover_asset_id = a.id
      WHERE g.slug = ?
    `;
    const game = await this.db.queryFirst<Game>(sql, [slug]);
    return game ? this.normalizeGame(game) : null;
  }

  async findById(id: string): Promise<Game | null> {
    const sql = `
      SELECT 
        g.*,
        c.name as category_name,
        c.slug as category_slug,
        a.storage_key as cover_storage_key
      FROM games g
      LEFT JOIN categories c ON g.category_id = c.id
      LEFT JOIN (
        SELECT ca.id, ca.storage_key
        FROM game_assets ca
        LEFT JOIN users co ON ca.owner_user_id = co.id
        WHERE ca.status = 'ACTIVE'
          AND ca.asset_type = 'COVER'
          AND ca.storage_key NOT LIKE 'users/%'
          AND (ca.owner_user_id IS NULL OR co.role = 'ADMIN')
      ) a ON g.cover_asset_id = a.id
      WHERE g.id = ?
    `;
    const game = await this.db.queryFirst<Game>(sql, [id]);
    return game ? this.normalizeGame(game) : null;
  }

  async createGame(game: Game): Promise<void> {
    // Default false comes from migration 0005. Omitting that default also keeps
    // older schema-only test fixtures valid when they do not use this feature.
    const featured = game.is_featured === true;
    await this.db.execute(
      `INSERT INTO games (id, name, slug, description, developer, publisher, release_year, category_id, cover_asset_id, status, visibility, source_type, created_by, published_at${featured ? ', is_featured' : ''}, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${featured ? ', ?' : ''}, datetime('now'), datetime('now'))`,
      [
        game.id,
        game.name,
        game.slug,
        game.description,
        game.developer,
        game.publisher,
        game.release_year,
        game.category_id,
        game.cover_asset_id,
        game.status,
        game.visibility,
        game.source_type,
        game.created_by,
        game.status === 'PUBLISHED' ? new Date().toISOString() : null,
        ...(featured ? [1] : []),
      ]
    );
  }

  async updateGame(id: string, updates: Partial<Game>): Promise<void> {
    const fields: string[] = [];
    const params: any[] = [];

    const allowedFields = [
      'name',
      'slug',
      'description',
      'developer',
      'publisher',
      'release_year',
      'category_id',
      'cover_asset_id',
      'status',
      'visibility',
      'is_featured',
    ];

    for (const key of allowedFields) {
      if ((updates as any)[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push(key === 'is_featured' ? (updates.is_featured ? 1 : 0) : (updates as any)[key]);
      }
    }

    if (updates.status === 'PUBLISHED') {
      fields.push("published_at = datetime('now')");
    }

    if (fields.length === 0) return;

    fields.push("updated_at = datetime('now')");
    params.push(id);

    await this.db.execute(`UPDATE games SET ${fields.join(', ')} WHERE id = ?`, params);
  }

  async deleteGame(id: string): Promise<void> {
    await this.db.execute('DELETE FROM games WHERE id = ?', [id]);
  }

  // Versions
  async findVersionsByGameId(gameId: string, activeOnly = true): Promise<GameVersion[]> {
    const activeCondition = activeOnly
      ? `AND v.status = 'ACTIVE'
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
         )`
      : '';
    const sql = `
      SELECT 
        v.*,
        jar.storage_key as jar_storage_key,
        jad.storage_key as jad_storage_key
      FROM game_versions v
      JOIN game_assets jar ON v.jar_asset_id = jar.id
      LEFT JOIN users jar_owner ON jar.owner_user_id = jar_owner.id
      LEFT JOIN game_assets jad ON v.jad_asset_id = jad.id
      LEFT JOIN users jad_owner ON jad.owner_user_id = jad_owner.id
      WHERE v.game_id = ? ${activeCondition}
      ORDER BY v.created_at DESC
    `;
    return this.db.query<GameVersion>(sql, [gameId]);
  }

  async findVersionById(versionId: string): Promise<GameVersion | null> {
    const sql = `
      SELECT 
        v.*,
        jar.storage_key as jar_storage_key,
        jad.storage_key as jad_storage_key
      FROM game_versions v
      JOIN game_assets jar ON v.jar_asset_id = jar.id
      LEFT JOIN game_assets jad ON v.jad_asset_id = jad.id
      WHERE v.id = ?
    `;
    return this.db.queryFirst<GameVersion>(sql, [versionId]);
  }

  async findGameByJarSha256(sha256: string): Promise<Game | null> {
    const sql = `
      SELECT g.*
      FROM game_versions v
      JOIN games g ON v.game_id = g.id
      WHERE v.jar_sha256 = ?
      LIMIT 1
    `;
    const game = await this.db.queryFirst<Game>(sql, [sha256]);
    if (game) return this.normalizeGame(game);

    const assetSql = `
      SELECT g.*
      FROM game_assets a
      JOIN game_versions v ON (v.jar_asset_id = a.id)
      JOIN games g ON v.game_id = g.id
      WHERE a.sha256 = ?
      LIMIT 1
    `;
    const assetGame = await this.db.queryFirst<Game>(assetSql, [sha256]);
    return assetGame ? this.normalizeGame(assetGame) : null;
  }

  async createVersion(version: GameVersion): Promise<void> {
    await this.db.execute(
      `INSERT INTO game_versions (id, game_id, version_name, jar_asset_id, jad_asset_id, jar_sha256, jad_sha256, file_size, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        version.id,
        version.game_id,
        version.version_name,
        version.jar_asset_id,
        version.jad_asset_id,
        version.jar_sha256,
        version.jad_sha256,
        version.file_size,
        version.status || 'ACTIVE',
      ]
    );
  }

  async deleteVersion(versionId: string): Promise<void> {
    await this.db.execute('DELETE FROM game_versions WHERE id = ?', [versionId]);
  }

  // Screenshots
  async findScreenshotsByGameId(gameId: string): Promise<GameScreenshot[]> {
    const sql = `
      SELECT s.*, a.storage_key
      FROM game_screenshots s
      JOIN game_assets a ON s.asset_id = a.id
      LEFT JOIN users o ON a.owner_user_id = o.id
      WHERE s.game_id = ? 
        AND a.status = 'ACTIVE'
        AND a.asset_type = 'SCREENSHOT'
        AND a.storage_key NOT LIKE 'users/%'
        AND (a.owner_user_id IS NULL OR o.role = 'ADMIN')
      ORDER BY s.sort_order ASC
    `;
    return this.db.query<GameScreenshot>(sql, [gameId]);
  }

  async addScreenshot(screenshot: GameScreenshot): Promise<void> {
    await this.db.execute(
      'INSERT INTO game_screenshots (id, game_id, asset_id, sort_order) VALUES (?, ?, ?, ?)',
      [screenshot.id, screenshot.game_id, screenshot.asset_id, screenshot.sort_order]
    );
  }

  async count(): Promise<{ total: number; published: number; draft: number }> {
    const totalRes = await this.db.queryFirst<{ count: number }>('SELECT count(*) as count FROM games');
    const pubRes = await this.db.queryFirst<{ count: number }>(
      "SELECT count(*) as count FROM games WHERE status = 'PUBLISHED'"
    );
    const draftRes = await this.db.queryFirst<{ count: number }>(
      "SELECT count(*) as count FROM games WHERE status = 'DRAFT'"
    );
    return {
      total: totalRes?.count || 0,
      published: pubRes?.count || 0,
      draft: draftRes?.count || 0,
    };
  }

  // --- Crawler duplicate guard (migration 0007) ---

  /**
   * Every game (all statuses, no paging) with what is needed to recognise a crawler entry that is
   * already in the catalog: its source_key, or — for games imported before 0007 — name + JAR file name.
   */
  async findImportIndex(): Promise<{ id: string; slug: string; name: string; source_key: string | null; jar_filename: string | null }[]> {
    return this.db.query(
      `SELECT g.id, g.slug, g.name, g.source_key, a.original_filename AS jar_filename
       FROM games g
       LEFT JOIN game_versions v ON v.game_id = g.id
       LEFT JOIN game_assets a ON a.id = v.jar_asset_id`
    );
  }

  async setSourceKey(gameId: string, sourceKey: string): Promise<void> {
    await this.db.execute('UPDATE games SET source_key = ? WHERE id = ?', [sourceKey, gameId]);
  }
}
