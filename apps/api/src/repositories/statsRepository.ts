import { DatabaseClient } from './db';

export interface ActivitySummary {
  users: { newLast7Days: number; blocked: number; google: number };
  games: { hidden: number; featured: number };
  plays: { total: number; activePlayersLast7Days: number };
  topGames: { id: string; name: string; slug: string; plays: number; players: number }[];
  crashReports: {
    open: number;
    latest: { id: string; game_name: string; game_slug: string | null; error_type: string; created_at: string }[];
  };
  failedUploadsLast7Days: number;
}

/**
 * Read-only figures for the admin dashboard. Plays are counted per signed-in account
 * (user_game_activity); anonymous visitors are not tracked.
 * julianday() parses both "YYYY-MM-DD HH:MM:SS" and ISO timestamps, so date windows work for every row.
 */
export class StatsRepository {
  constructor(private db: DatabaseClient) {}

  async getActivitySummary(): Promise<ActivitySummary> {
    const users = await this.db.queryFirst<{ new7: number | null; blocked: number | null; google: number | null }>(
      `SELECT
         SUM(CASE WHEN julianday(created_at) >= julianday('now', '-7 days') THEN 1 ELSE 0 END) AS new7,
         SUM(CASE WHEN status = 'BLOCKED' THEN 1 ELSE 0 END) AS blocked,
         SUM(CASE WHEN google_sub IS NOT NULL THEN 1 ELSE 0 END) AS google
       FROM users`
    );
    const games = await this.db.queryFirst<{ hidden: number | null; featured: number | null }>(
      `SELECT
         SUM(CASE WHEN status = 'HIDDEN' THEN 1 ELSE 0 END) AS hidden,
         SUM(CASE WHEN is_featured = 1 THEN 1 ELSE 0 END) AS featured
       FROM games`
    );
    const plays = await this.db.queryFirst<{ total: number | null; active: number | null }>(
      `SELECT
         COALESCE(SUM(play_count), 0) AS total,
         COUNT(DISTINCT CASE WHEN julianday(last_played_at) >= julianday('now', '-7 days') THEN user_id END) AS active
       FROM user_game_activity
       WHERE activity_type = 'PLAY'`
    );
    const topGames = await this.db.query<{ id: string; name: string; slug: string; plays: number; players: number }>(
      `SELECT g.id, g.name, g.slug, SUM(a.play_count) AS plays, COUNT(DISTINCT a.user_id) AS players
       FROM user_game_activity a
       JOIN games g ON g.id = a.game_id
       WHERE a.activity_type = 'PLAY'
       GROUP BY g.id, g.name, g.slug
       ORDER BY plays DESC, players DESC, g.name ASC
       LIMIT 5`
    );
    const openCrashes = await this.db.queryFirst<{ total: number }>(
      `SELECT COUNT(*) AS total FROM game_crash_reports WHERE status IN ('OPEN', 'INVESTIGATING')`
    );
    const latestCrashes = await this.db.query<ActivitySummary['crashReports']['latest'][number]>(
      `SELECT id, game_name, game_slug, error_type, created_at
       FROM game_crash_reports
       WHERE status IN ('OPEN', 'INVESTIGATING')
       ORDER BY created_at DESC
       LIMIT 5`
    );
    const failedUploads = await this.db.queryFirst<{ total: number }>(
      `SELECT COUNT(*) AS total FROM upload_jobs
       WHERE status = 'FAILED' AND julianday(created_at) >= julianday('now', '-7 days')`
    );

    return {
      users: { newLast7Days: users?.new7 ?? 0, blocked: users?.blocked ?? 0, google: users?.google ?? 0 },
      games: { hidden: games?.hidden ?? 0, featured: games?.featured ?? 0 },
      plays: { total: plays?.total ?? 0, activePlayersLast7Days: plays?.active ?? 0 },
      topGames: topGames.map((g) => ({ ...g, plays: Number(g.plays) || 0, players: Number(g.players) || 0 })),
      crashReports: { open: openCrashes?.total ?? 0, latest: latestCrashes },
      failedUploadsLast7Days: failedUploads?.total ?? 0,
    };
  }
}
