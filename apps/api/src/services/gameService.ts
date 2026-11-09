import { GameRepository, GameFilter } from '../repositories/gameRepository';
import { CategoryRepository } from '../repositories/categoryRepository';
import { StorageDriver } from '../storage/storage';
import { Game, GameVersion } from '@gametuoitho/shared-types';

export class GameService {
  constructor(
    private gameRepo: GameRepository,
    private categoryRepo: CategoryRepository,
    private storage: StorageDriver
  ) {}

  private enrichGameUrls(game: any): Game {
    return {
      ...game,
      cover_url: game.cover_storage_key ? this.storage.getUrl(game.cover_storage_key) : null,
    };
  }

  private enrichVersionUrls(version: any): GameVersion {
    return {
      ...version,
      jar_url: version.jar_storage_key ? this.storage.getUrl(version.jar_storage_key) : '',
      jad_url: version.jad_storage_key ? this.storage.getUrl(version.jad_storage_key) : null,
    };
  }

  async getPublicGames(filter: Omit<GameFilter, 'status' | 'visibility'>) {
    const res = await this.gameRepo.findGames({
      ...filter,
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
    });

    return {
      games: res.games.map((g) => this.enrichGameUrls(g)),
      total: res.total,
      page: filter.page || 1,
      limit: filter.limit || 20,
      totalPages: Math.ceil(res.total / (filter.limit || 20)),
    };
  }

  async getGameDetail(slug: string) {
    const game = await this.gameRepo.findBySlug(slug);
    if (!game) return null;

    if (game.status !== 'PUBLISHED' || game.visibility !== 'PUBLIC') {
      return null;
    }

    const versions = await this.gameRepo.findVersionsByGameId(game.id, true);
    const screenshots = await this.gameRepo.findScreenshotsByGameId(game.id);

    return {
      game: this.enrichGameUrls(game),
      versions: versions.map((v) => this.enrichVersionUrls(v)),
      screenshots: screenshots.map((s: any) => ({
        ...s,
        url: this.storage.getUrl(s.storage_key),
      })),
    };
  }

  async getGameVersions(gameId: string) {
    const versions = await this.gameRepo.findVersionsByGameId(gameId, true);
    return versions.map((v) => this.enrichVersionUrls(v));
  }

  async getCategories() {
    return this.categoryRepo.findAll(true);
  }

  async searchGames(query: string, limit = 20) {
    const res = await this.gameRepo.findGames({
      search: query,
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
      limit,
    });

    return res.games.map((g) => this.enrichGameUrls(g));
  }
}
