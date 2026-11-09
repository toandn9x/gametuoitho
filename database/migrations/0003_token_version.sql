-- 0003_token_version.sql: Them cot token_version ho tro thu hoi phien (Session Revocation)
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
