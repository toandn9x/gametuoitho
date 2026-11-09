-- Admin-curated homepage collection, separate from personal FAVORITE activity.
ALTER TABLE games ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0
  CHECK (is_featured IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_games_public_featured
  ON games(is_featured, created_at DESC)
  WHERE status = 'PUBLISHED' AND visibility = 'PUBLIC';
