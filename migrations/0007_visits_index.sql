-- Audit 2026-11 (#8, #9): bounded visitor-statistics queries and duplicate
-- suppression.
--
-- The 30-second duplicate check in POST /api/visitors filters on
-- (visitor_hash, path) and orders created_at against a relative cutoff:
--   SELECT id FROM visits WHERE visitor_hash = ? AND path = ?
--     AND created_at >= datetime('now', '-30 seconds') LIMIT 1
-- so a composite index on those three columns turns it into an index range scan
-- instead of a table scan. It is also the index that keeps the per-path
-- aggregation cheap; the generic path-only index covers the "top paths" query.
--
-- The existing indexes from 0001/0003 (created_at, visitor_hash, country,
-- referrer_host) stay: the 30-day/180-day window filters still use created_at.
CREATE INDEX IF NOT EXISTS idx_visits_path ON visits(path);
CREATE INDEX IF NOT EXISTS idx_visits_hash_path_created ON visits(visitor_hash, path, created_at);
