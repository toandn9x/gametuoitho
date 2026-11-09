-- 0004_library_constraints.sql
-- Enforce unique index for user imports to prevent duplicate import entries per user (Plan 4.3)
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_import_asset ON user_library(user_id, custom_asset_id) WHERE source_type = 'IMPORT';
