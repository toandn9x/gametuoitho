-- 0002_crash_reports.sql: Game Crash and Error Reporting

CREATE TABLE IF NOT EXISTS game_crash_reports (
  id TEXT PRIMARY KEY,
  game_id TEXT,
  game_version_id TEXT,
  game_slug TEXT,
  game_name TEXT NOT NULL,
  user_id TEXT,
  error_type TEXT NOT NULL CHECK (error_type IN ('LOAD_FAILED', 'CRASH', 'EMULATOR_ERROR', 'CORRUPT_JAR', 'USER_REPORT')),
  error_message TEXT NOT NULL,
  stack_trace TEXT,
  user_agent TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'INVESTIGATING', 'RESOLVED', 'IGNORED')),
  admin_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_crash_reports_game ON game_crash_reports(game_id);
CREATE INDEX IF NOT EXISTS idx_crash_reports_status ON game_crash_reports(status);
CREATE INDEX IF NOT EXISTS idx_crash_reports_created ON game_crash_reports(created_at);
