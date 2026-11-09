import { DatabaseClient } from './db';
import { Game, GameVersion, GameScreenshot } from '@gametuoitho/shared-types';

export interface GameFilter {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: string;
  categorySlug?: string;
  status?: Game['status'];
  visibility?: Game['visibility'];
  sort?: 'newest' | 'popular' | 'name';
}

export class GameRepository {
  constructor(private db: DatabaseClient) {}

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
      LEFT JOIN game_assets a ON g.cover_asset_id = a.id
      ${whereSql}
      ${orderSql}
      LIMIT ? OFFSET ?
    `;

    const games = await this.db.query<Game>(selectSql, [...params, limit, offset]);

    return { games, total };
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
      LEFT JOIN game_assets a ON g.cover_asset_id = a.id
      WHERE g.slug = ?
    `;
    return this.db.queryFirst<Game>(sql, [slug]);
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
      LEFT JOIN game_assets a ON g.cover_asset_id = a.id
      WHERE g.id = ?
    `;
    return this.db.queryFirst<Game>(sql, [id]);
  }

  async createGame(game: Game): Promise<void> {
    await this.db.execute(
      `INSERT INTO games (id, name, slug, description, developer, publisher, release_year, category_id, cover_asset_id, status, visibility, source_type, created_by, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
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
    ];

    for (const key of allowedFields) {
      if ((updates as any)[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push((updates as any)[key]);
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
    const sql = `
      SELECT 
        v.*,
        jar.storage_key as jar_storage_key,
        jad.storage_key as jad_storage_key
      FROM game_versions v
      JOIN game_assets jar ON v.jar_asset_id = jar.id
      LEFT JOIN game_assets jad ON v.jad_asset_id = jad.id
      WHERE v.game_id = ? ${activeOnly ? "AND v.status = 'ACTIVE'" : ''}
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
      WHERE s.game_id = ?
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
}
