import * as fs from 'fs';
import * as path from 'path';
import { GameRepository } from '../repositories/gameRepository';
import { CategoryRepository } from '../repositories/categoryRepository';
import { AssetRepository } from '../repositories/assetRepository';
import { StorageDriver } from '../storage/storage';
import { slugify, computeSha256, generateId, validateJarFile } from '@gametuoitho/shared-utils';
import { Game, GameVersion, GameAsset, Category } from '@gametuoitho/shared-types';

export interface SourceGameItem {
  id: string;
  name: string;
  developer: string;
  category: string;
  categoryKey: string;
  year: number;
  icon: string;
  filename: string;
  description: string;
  phone?: string;
  width?: number;
  height?: number;
  is_imported?: boolean;
  imported_slug?: string;
}

export class CrawlerService {
  private cachedCatalog: SourceGameItem[] | null = null;

  constructor(
    private gameRepo: GameRepository,
    private categoryRepo: CategoryRepository,
    private assetRepo: AssetRepository,
    private storage: StorageDriver
  ) {}

  private loadCatalog(): SourceGameItem[] {
    if (this.cachedCatalog) return this.cachedCatalog;

    // Search for catalog json file
    const possiblePaths = [
      path.resolve(process.cwd(), 'database/gametuoitho_cc_catalog.json'),
      path.resolve(process.cwd(), '../../database/gametuoitho_cc_catalog.json'),
      path.resolve(__dirname, '../../../database/gametuoitho_cc_catalog.json'),
      path.resolve(__dirname, '../../../../database/gametuoitho_cc_catalog.json'),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        try {
          const raw = fs.readFileSync(p, 'utf-8');
          this.cachedCatalog = JSON.parse(raw);
          return this.cachedCatalog!;
        } catch (err) {
          console.error('[CrawlerService] Error parsing catalog file:', err);
        }
      }
    }

    console.warn('[CrawlerService] Catalog file not found in any path');
    return [];
  }

  async searchSourceGames(params: {
    search?: string;
    category?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    games: SourceGameItem[];
    pagination: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const catalog = this.loadCatalog();
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));

    // Get list of already imported games to mark them
    const { games: localGames } = await this.gameRepo.findGames({ limit: 10000 });
    const localNames = new Set(localGames.map((g) => g.name.toLowerCase()));
    const localSlugs = new Map(localGames.map((g) => [g.name.toLowerCase(), g.slug]));

    let filtered = catalog;

    if (params.search) {
      const q = params.search.toLowerCase().trim();
      filtered = filtered.filter(
        (g) =>
          g.name.toLowerCase().includes(q) ||
          g.developer.toLowerCase().includes(q) ||
          g.filename.toLowerCase().includes(q)
      );
    }

    if (params.category && params.category !== 'all') {
      const cat = params.category.toLowerCase().trim();
      filtered = filtered.filter(
        (g) =>
          g.category.toLowerCase().includes(cat) ||
          g.categoryKey.toLowerCase() === cat
      );
    }

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    const paged = filtered.slice(offset, offset + limit);

    const result = paged.map((g) => {
      const isImported = localNames.has(g.name.toLowerCase());
      return {
        ...g,
        is_imported: isImported,
        imported_slug: localSlugs.get(g.name.toLowerCase()),
      };
    });

    return {
      games: result,
      pagination: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  async importGameFromSource(
    sourceGameId: string,
    adminUserId: string
  ): Promise<{ game: Game; version: GameVersion }> {
    const catalog = this.loadCatalog();
    const sourceGame = catalog.find((g) => g.id === sourceGameId);
    if (!sourceGame) {
      throw new Error(`Không tìm thấy game với ID "${sourceGameId}" trên nguồn gametuoitho.cc`);
    }

    // 1. Generate slug & check duplication
    let baseSlug = slugify(sourceGame.name);
    if (!baseSlug) baseSlug = slugify(sourceGame.id);

    const existingGame = await this.gameRepo.findBySlug(baseSlug);
    let finalSlug = baseSlug;
    if (existingGame) {
      finalSlug = `${baseSlug}-${generateId().slice(0, 4)}`;
    }

    // 2. Map or ensure Category
    let categoryId = await this.ensureCategory(sourceGame.category);

    // 3. Download JAR binary
    const jarUrl = `https://gametuoitho.cc/games/${encodeURI(sourceGame.filename)}`;
    console.log(`[CrawlerService] Downloading JAR from ${jarUrl}...`);
    const jarRes = await fetch(jarUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!jarRes.ok) {
      throw new Error(`Tải file JAR thất bại: HTTP ${jarRes.status} (${jarUrl})`);
    }

    const jarArrayBuffer = await jarRes.arrayBuffer();
    // Validate JAR binary
    const validation = validateJarFile(new Uint8Array(jarArrayBuffer));
    if (!validation.valid) {
      throw new Error(validation.error || 'File JAR không hợp lệ');
    }

    const jarSha256 = await computeSha256(jarArrayBuffer);
    const jarStorageKey = `games/${finalSlug}/versions/1.0.0/${path.basename(sourceGame.filename)}`;

    await this.storage.put(jarStorageKey, jarArrayBuffer, 'application/java-archive');

    const jarAssetId = generateId();
    await this.assetRepo.create({
      id: jarAssetId,
      owner_user_id: adminUserId,
      asset_type: 'JAR',
      storage_key: jarStorageKey,
      original_filename: path.basename(sourceGame.filename),
      mime_type: 'application/java-archive',
      file_size: jarArrayBuffer.byteLength,
      sha256: jarSha256,
      status: 'ACTIVE',
    });

    // 4. Download Cover icon if available
    let coverAssetId: string | null = null;
    if (sourceGame.icon) {
      try {
        const iconUrl = sourceGame.icon.startsWith('http')
          ? sourceGame.icon
          : `https://gametuoitho.cc${sourceGame.icon}`;

        console.log(`[CrawlerService] Downloading Cover from ${iconUrl}...`);
        const iconRes = await fetch(iconUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (iconRes.ok) {
          const iconBuffer = await iconRes.arrayBuffer();
          const ext = path.extname(sourceGame.icon) || '.png';
          const coverStorageKey = `games/${finalSlug}/covers/cover${ext}`;
          const mimeType = ext === '.webp' ? 'image/webp' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';

          await this.storage.put(coverStorageKey, iconBuffer, mimeType);
          const iconSha256 = await computeSha256(iconBuffer);

          coverAssetId = generateId();
          await this.assetRepo.create({
            id: coverAssetId,
            owner_user_id: adminUserId,
            asset_type: 'COVER',
            storage_key: coverStorageKey,
            original_filename: `cover${ext}`,
            mime_type: mimeType,
            file_size: iconBuffer.byteLength,
            sha256: iconSha256,
            status: 'ACTIVE',
          });
        }
      } catch (err) {
        console.warn(`[CrawlerService] Failed to fetch cover for ${sourceGame.name}, continuing without cover:`, err);
      }
    }

    // 5. Create Game Record
    const gameId = generateId();
    const game: Game = {
      id: gameId,
      name: sourceGame.name,
      slug: finalSlug,
      description: sourceGame.description || `Tựa game Java ME kinh điển ${sourceGame.name} của ${sourceGame.developer}.`,
      developer: sourceGame.developer || 'Nokia / J2ME',
      publisher: sourceGame.developer || 'Nokia',
      release_year: sourceGame.year || 2008,
      category_id: categoryId,
      cover_asset_id: coverAssetId,
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
      source_type: 'ADMIN',
      created_by: adminUserId,
    };

    await this.gameRepo.createGame(game);

    // 6. Create Version Record
    const versionId = generateId();
    const version: GameVersion = {
      id: versionId,
      game_id: gameId,
      version_name: `Bản Chuẩn (${sourceGame.width || 240}x${sourceGame.height || 320})`,
      jar_asset_id: jarAssetId,
      file_size: jarArrayBuffer.byteLength,
      jar_sha256: jarSha256,
      status: 'ACTIVE',
    };

    await this.gameRepo.createVersion(version);

    console.log(`[CrawlerService] Successfully imported "${game.name}" (Slug: ${game.slug})!`);
    return { game, version };
  }

  private async ensureCategory(catName: string): Promise<string> {
    const raw = (catName || '').trim();
    const lower = raw.toLowerCase();

    // Map known categories
    if (lower.includes('nhập vai') || lower.includes('rpg')) return 'cat-rpg';
    if (lower.includes('hành động') || lower.includes('phiêu lưu') || lower.includes('action')) return 'cat-action';
    if (lower.includes('trí tuệ') || lower.includes('giải đố') || lower.includes('puzzle')) return 'cat-puzzle';
    if (lower.includes('đua xe') || lower.includes('thể thao') || lower.includes('racing') || lower.includes('sport')) return 'cat-racing';
    if (lower.includes('đời sống') || lower.includes('nông trại') || lower.includes('casual')) return 'cat-casual';
    if (lower.includes('bắn súng') || lower.includes('arcade') || lower.includes('shooter')) return 'cat-shooter';

    // Check if category already exists in DB by slug
    const slug = slugify(raw) || 'the-loai-khac';
    const existing = await this.categoryRepo.findBySlug(slug);
    if (existing) return existing.id;

    // Create new category in DB
    const newId = `cat-${slug}`;
    const newCategory: Category = {
      id: newId,
      name: raw || 'Khác',
      slug,
      description: `Các tựa game thuộc thể loại ${raw}`,
      sort_order: 10,
      status: 'ACTIVE',
    };
    await this.categoryRepo.create(newCategory);
    return newId;
  }
}
