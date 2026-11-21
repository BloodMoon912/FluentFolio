-- Server-side revocable admin sessions (#13).
--
-- The admin cookie carries a random session id + HMAC signature; this table is
-- the authoritative record that allows a session to be revoked before its
-- seven-day expiry. `expires_at` / `revoked_at` / `last_seen_at` are Unix
-- seconds (integers) so comparisons never depend on SQLite's text dates.
CREATE TABLE IF NOT EXISTS admin_sessions (
  session_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  last_seen_at INTEGER
);

-- Index the columns used by the expiry cleanup and validation queries.
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);
