-- 0006_google_auth.sql: Sign in with Google.
-- google_sub is Google's stable account id (the "sub" claim of a verified Google ID token).
-- Accounts created through Google get an unusable password_hash, so they can only sign in with Google.
ALTER TABLE users ADD COLUMN google_sub TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_google_sub ON users(google_sub);
