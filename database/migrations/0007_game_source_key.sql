-- 0007_game_source_key.sql: remember which gametuoitho.cc catalog entry a game was imported from.
-- The crawler refuses to import the same entry twice; the UNIQUE index also stops two concurrent
-- imports of the same entry. NULL for games created manually or imported before this migration.
ALTER TABLE games ADD COLUMN source_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_games_source_key ON games(source_key);
