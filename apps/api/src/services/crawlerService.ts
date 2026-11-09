import * as fs from 'fs';
import * as path from 'path';
import { GameRepository } from '../repositories/gameRepository';
import { CategoryRepository } from '../repositories/categoryRepository';
import { AssetRepository } from '../repositories/assetRepository';
import { StorageDriver } from '../storage/storage';
import { slugify, computeSha256, generateId, validateJarFile } from '@gametuoitho/shared-utils';
import { Game, GameVersion, GameAsset, Category } from '@gametuoitho/shared-types';

export class ConflictError extends Error {
  slug: string;
  constructor(message: string, slug: string) {
    super(message);
    this.name = 'ConflictError';
    this.slug = slug;
  }
}

export interface SourceGameItem {
  id: string;
  source_key?: string;
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

export function computeStableSourceKey(id: string, filename: string): string {
  let hash = 5381;
  const str = `${id}:${filename}`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `${id}_${hex}`;
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
          const parsed = JSON.parse(raw) as SourceGameItem[];
          this.cachedCatalog = parsed.map((item) => ({
            ...item,
            source_key: item.source_key || computeStableSourceKey(item.id, item.filename),
          }));
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

  private async safeFetchFromSource(
    urlStr: string,
    options: { maxBytes: number; timeoutMs?: number }
  ): Promise<Uint8Array> {
    let currentUrl: URL;
    try {
      currentUrl = new URL(urlStr, 'https://gametuoitho.cc');
    } catch {
      throw new Error(`URL không hợp lệ: ${urlStr}`);
    }

    if (currentUrl.protocol !== 'https:' || currentUrl.hostname !== 'gametuoitho.cc') {
      throw new Error(
        `Chỉ được phép tải tài nguyên từ https://gametuoitho.cc (host bị từ chối: ${currentUrl.hostname})`
      );
    }

    let hops = 0;
    while (hops < 3) {
      hops++;
      const res = await fetch(currentUrl.toString(), {
        redirect: 'manual',
        signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) {
          throw new Error(`Chuyển hướng không có tiêu đề Location (HTTP ${res.status})`);
        }
        let redirectUrl: URL;
        try {
          redirectUrl = new URL(location, currentUrl.toString());
        } catch {
          throw new Error(`URL chuyển hướng không hợp lệ: ${location}`);
        }
        if (redirectUrl.protocol !== 'https:' || redirectUrl.hostname !== 'gametuoitho.cc') {
          throw new Error(
            `Redirect sang host khác bị từ chối (host đích: ${redirectUrl.hostname})`
          );
        }
        currentUrl = redirectUrl;
        continue;
      }

      if (!res.ok) {
        throw new Error(`Tải file thất bại: HTTP ${res.status} (${currentUrl.toString()})`);
      }

      const contentLength = res.headers.get('content-length');
      if (contentLength && Number(contentLength) > options.maxBytes) {
        throw new Error(
          `Dung lượng file vượt quá giới hạn cho phép (${options.maxBytes} bytes)`
        );
      }

      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > options.maxBytes) {
              await reader.cancel().catch(() => {});
              throw new Error(
                `Dung lượng file vượt quá giới hạn cho phép (${options.maxBytes} bytes)`
              );
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock?.();
        }

        const out = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          out.set(c, offset);
          offset += c.byteLength;
        }
        return out;
      } else {
        const ab = await res.arrayBuffer();
        if (ab.byteLength > options.maxBytes) {
          throw new Error(
            `Dung lượng file vượt quá giới hạn cho phép (${options.maxBytes} bytes)`
          );
        }
        return new Uint8Array(ab);
      }
    }

    throw new Error('Vượt quá số lần chuyển hướng cho phép (tối đa 3 lần)');
  }

  private detectImageFormat(bytes: Uint8Array): { mimeType: string; ext: string } {
    if (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    ) {
      return { mimeType: 'image/png', ext: '.png' };
    }

    if (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    ) {
      return { mimeType: 'image/jpeg', ext: '.jpg' };
    }

    if (
      bytes.length >= 6 &&
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x38 &&
      (bytes[4] === 0x37 || bytes[4] === 0x39) &&
      bytes[5] === 0x61
    ) {
      return { mimeType: 'image/gif', ext: '.gif' };
    }

    if (
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return { mimeType: 'image/webp', ext: '.webp' };
    }

    throw new Error('Định dạng ảnh bìa không hợp lệ (chỉ chấp nhận PNG, JPEG, WebP, GIF)');
  }

  async importGameFromSource(
    sourceGameId: string,
    adminUserId: string
  ): Promise<{ game: Game; version: GameVersion }> {
    const catalog = this.loadCatalog();
    const sourceGame = catalog.find((g) => g.source_key === sourceGameId || g.id === sourceGameId);
    if (!sourceGame) {
      throw new Error(`Không tìm thấy game với ID "${sourceGameId}" trên nguồn gametuoitho.cc`);
    }

    // 1. Download & Validate JAR binary
    const sanitizedFilename = sourceGame.filename.replace(/^\/+/, '');
    const jarUrl = `https://gametuoitho.cc/games/${encodeURI(sanitizedFilename)}`;
    const jarBytes = await this.safeFetchFromSource(jarUrl, { maxBytes: 50 * 1024 * 1024 });

    const validation = await validateJarFile(jarBytes);
    if (!validation.valid) {
      throw new Error(validation.error || 'File JAR không hợp lệ');
    }

    const jarSha256 = await computeSha256(
      jarBytes.buffer.slice(jarBytes.byteOffset, jarBytes.byteOffset + jarBytes.byteLength) as ArrayBuffer
    );

    // Anti-duplication check: if Catalog already has this SHA-256, return 409
    const duplicateGame = await this.gameRepo.findGameByJarSha256(jarSha256);
    if (duplicateGame) {
      throw new ConflictError(
        `Game đã tồn tại trong Catalog với mã SHA-256 trùng khớp (slug: ${duplicateGame.slug})`,
        duplicateGame.slug
      );
    }

    // 2. Download & Validate Cover image (if available)
    let coverBytes: Uint8Array | null = null;
    let coverInfo: { mimeType: string; ext: string } | null = null;
    let coverSha256: string | null = null;

    if (sourceGame.icon) {
      if (sourceGame.icon.startsWith('http://') || sourceGame.icon.startsWith('https://')) {
        const iconUrlObj = new URL(sourceGame.icon);
        if (iconUrlObj.protocol !== 'https:' || iconUrlObj.hostname !== 'gametuoitho.cc') {
          throw new Error(
            `URL ảnh bìa trỏ tới host không an toàn: ${iconUrlObj.hostname}`
          );
        }
      }
      const iconPath = sourceGame.icon.startsWith('/') ? sourceGame.icon : `/${sourceGame.icon}`;
      const iconUrl = sourceGame.icon.startsWith('http')
        ? sourceGame.icon
        : `https://gametuoitho.cc${iconPath}`;

      coverBytes = await this.safeFetchFromSource(iconUrl, { maxBytes: 2 * 1024 * 1024 });
      coverInfo = this.detectImageFormat(coverBytes);
      coverSha256 = await computeSha256(
        coverBytes.buffer.slice(coverBytes.byteOffset, coverBytes.byteOffset + coverBytes.byteLength) as ArrayBuffer
      );
    }

    // 3. Generate slugs & IDs
    let baseSlug = slugify(sourceGame.name);
    if (!baseSlug) baseSlug = slugify(sourceGame.id);

    const existingGame = await this.gameRepo.findBySlug(baseSlug);
    let finalSlug = baseSlug;
    if (existingGame) {
      finalSlug = `${baseSlug}-${generateId().slice(0, 4)}`;
    }

    const categoryId = await this.ensureCategory(sourceGame.category);

    const gameId = generateId();
    const versionId = generateId();
    const jarAssetId = generateId();
    const jarStorageKey = `games/${gameId}/versions/${versionId}/game.jar`;
    const coverAssetId = coverBytes && coverInfo ? generateId() : null;
    const coverStorageKey = coverBytes && coverInfo ? `games/${gameId}/covers/cover${coverInfo.ext}` : null;

    // 4. Atomic persistence with rollback tracking
    const createdStorageKeys: string[] = [];
    const createdAssetIds: string[] = [];
    let createdGameId: string | null = null;
    let createdVersionId: string | null = null;

    try {
      // Put JAR to storage
      await this.storage.put(
        jarStorageKey,
        jarBytes.buffer.slice(jarBytes.byteOffset, jarBytes.byteOffset + jarBytes.byteLength) as ArrayBuffer,
        'application/java-archive'
      );
      createdStorageKeys.push(jarStorageKey);

      const now = new Date().toISOString();

      // Create JAR asset
      const jarAsset: GameAsset = {
        id: jarAssetId,
        owner_user_id: adminUserId,
        asset_type: 'JAR',
        storage_key: jarStorageKey,
        original_filename: path.basename(sourceGame.filename),
        mime_type: 'application/java-archive',
        file_size: jarBytes.byteLength,
        sha256: jarSha256,
        status: 'ACTIVE',
        created_at: now,
      };
      await this.assetRepo.create(jarAsset);
      createdAssetIds.push(jarAssetId);

      // Create Cover if available
      if (coverBytes && coverInfo && coverAssetId && coverStorageKey && coverSha256) {
        await this.storage.put(
          coverStorageKey,
          coverBytes.buffer.slice(coverBytes.byteOffset, coverBytes.byteOffset + coverBytes.byteLength) as ArrayBuffer,
          coverInfo.mimeType
        );
        createdStorageKeys.push(coverStorageKey);

        const coverAsset: GameAsset = {
          id: coverAssetId,
          owner_user_id: adminUserId,
          asset_type: 'COVER',
          storage_key: coverStorageKey,
          original_filename: `cover${coverInfo.ext}`,
          mime_type: coverInfo.mimeType,
          file_size: coverBytes.byteLength,
          sha256: coverSha256,
          status: 'ACTIVE',
          created_at: now,
        };
        await this.assetRepo.create(coverAsset);
        createdAssetIds.push(coverAssetId);
      }

      // Create Game in DRAFT
      const game: Game = {
        id: gameId,
        name: sourceGame.name,
        slug: finalSlug,
        description:
          sourceGame.description ||
          `Tựa game Java ME kinh điển ${sourceGame.name} của ${sourceGame.developer}.`,
        developer: sourceGame.developer || 'Nokia / J2ME',
        publisher: sourceGame.developer || 'Nokia',
        release_year: sourceGame.year || 2008,
        category_id: categoryId,
        cover_asset_id: coverAssetId,
        status: 'DRAFT',
        visibility: 'PUBLIC',
        is_featured: false,
        source_type: 'ADMIN',
        created_by: adminUserId,
        published_at: null,
        created_at: now,
        updated_at: now,
      };
      await this.gameRepo.createGame(game);
      createdGameId = gameId;

      // Create Version in ACTIVE
      const version: GameVersion = {
        id: versionId,
        game_id: gameId,
        version_name: `Bản Chuẩn (${sourceGame.width || 240}x${sourceGame.height || 320})`,
        jar_asset_id: jarAssetId,
        jad_asset_id: null,
        jar_sha256: jarSha256,
        jad_sha256: null,
        file_size: jarBytes.byteLength,
        status: 'ACTIVE',
        created_at: now,
      };
      await this.gameRepo.createVersion(version);
      createdVersionId = versionId;

      return { game, version };
    } catch (err) {
      if (createdVersionId) {
        await this.gameRepo.deleteVersion(createdVersionId).catch(() => {});
      }
      if (createdGameId) {
        await this.gameRepo.deleteGame(createdGameId).catch(() => {});
      }
      for (const assetId of createdAssetIds) {
        await this.assetRepo.delete(assetId).catch(() => {});
      }
      for (const key of createdStorageKeys) {
        await this.storage.delete(key).catch(() => {});
      }
      throw err;
    }
  }

  private async ensureCategory(catName: string): Promise<string> {
    const raw = (catName || '').trim();
    const lower = raw.toLowerCase();

    if (lower.includes('nhập vai') || lower.includes('rpg')) return 'cat-rpg';
    if (lower.includes('hành động') || lower.includes('phiêu lưu') || lower.includes('action')) return 'cat-action';
    if (lower.includes('trí tuệ') || lower.includes('giải đố') || lower.includes('puzzle')) return 'cat-puzzle';
    if (lower.includes('đua xe') || lower.includes('thể thao') || lower.includes('racing') || lower.includes('sport')) return 'cat-racing';
    if (lower.includes('đời sống') || lower.includes('nông trại') || lower.includes('casual')) return 'cat-casual';
    if (lower.includes('bắn súng') || lower.includes('arcade') || lower.includes('shooter')) return 'cat-shooter';

    const slug = slugify(raw) || 'the-loai-khac';
    const existing = await this.categoryRepo.findBySlug(slug);
    if (existing) return existing.id;

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
