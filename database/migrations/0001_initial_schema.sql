-- 0001_initial_schema.sql: Database schema for Game Tuổi Thơ (Cloudflare D1 / SQLite)

-- 1. Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'BLOCKED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 2. Categories
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);

-- 3. Game Assets (All files on R2: JAR, JAD, COVER, SCREENSHOT)
CREATE TABLE IF NOT EXISTS game_assets (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('JAR', 'JAD', 'COVER', 'SCREENSHOT')),
  storage_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('UPLOADING', 'ACTIVE', 'QUARANTINED', 'DELETED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_game_assets_owner ON game_assets(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_game_assets_sha256 ON game_assets(sha256);

-- 4. Games (Catalog)
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  developer TEXT,
  publisher TEXT,
  release_year INTEGER,
  category_id TEXT NOT NULL,
  cover_asset_id TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'HIDDEN', 'ARCHIVED')),
  visibility TEXT NOT NULL DEFAULT 'PUBLIC' CHECK (visibility IN ('PUBLIC', 'PRIVATE')),
  source_type TEXT NOT NULL DEFAULT 'ADMIN' CHECK (source_type IN ('ADMIN', 'USER_SUBMISSION')),
  created_by TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
  FOREIGN KEY (cover_asset_id) REFERENCES game_assets(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_games_slug ON games(slug);
CREATE INDEX IF NOT EXISTS idx_games_category ON games(category_id);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);

-- 5. Game Versions
CREATE TABLE IF NOT EXISTS game_versions (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  version_name TEXT NOT NULL,
  jar_asset_id TEXT NOT NULL,
  jad_asset_id TEXT,
  jar_sha256 TEXT NOT NULL,
  jad_sha256 TEXT,
  file_size INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (jar_asset_id) REFERENCES game_assets(id) ON DELETE RESTRICT,
  FOREIGN KEY (jad_asset_id) REFERENCES game_assets(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_game_versions_game ON game_versions(game_id);

-- 6. Game Screenshots
CREATE TABLE IF NOT EXISTS game_screenshots (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES game_assets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_game_screenshots_game ON game_screenshots(game_id);

-- 7. User Library (Catalog games added or private imports)
CREATE TABLE IF NOT EXISTS user_library (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  game_id TEXT,
  game_version_id TEXT,
  custom_asset_id TEXT,
  custom_name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('CATALOG', 'IMPORT')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (game_version_id) REFERENCES game_versions(id) ON DELETE SET NULL,
  FOREIGN KEY (custom_asset_id) REFERENCES game_assets(id) ON DELETE CASCADE,
  CONSTRAINT chk_library_source CHECK (
    (source_type = 'CATALOG' AND game_id IS NOT NULL AND custom_asset_id IS NULL) OR
    (source_type = 'IMPORT' AND custom_asset_id IS NOT NULL AND game_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_catalog_game ON user_library(user_id, game_id) WHERE source_type = 'CATALOG';
CREATE INDEX IF NOT EXISTS idx_user_library_user ON user_library(user_id);

-- 8. User Game Activity (Play count, Last played, Favorites)
CREATE TABLE IF NOT EXISTS user_game_activity (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  game_id TEXT,
  user_library_id TEXT,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('PLAY', 'FAVORITE')),
  last_played_at TEXT NOT NULL DEFAULT (datetime('now')),
  play_count INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (user_library_id) REFERENCES user_library(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user ON user_game_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_game ON user_game_activity(game_id);

-- 9. Upload Jobs
CREATE TABLE IF NOT EXISTS upload_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES game_assets(id) ON DELETE CASCADE
);

-- 10. Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
