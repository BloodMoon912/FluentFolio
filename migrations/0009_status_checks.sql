-- Status probe history (#4).
--
-- One row per real /api/status probe, throttled to at most one row per five
-- minutes (no Cron Trigger: the throttle uses the newest existing row). A new
-- table is used rather than the existing `incidents` table: `incidents` is a
-- legacy, never-written table of human-authored per-service incident events
-- with TEXT timestamps; these rows are machine-sampled probe results queried by
-- integer time ranges. Reusing it would mix two record types in one schema.
CREATE TABLE IF NOT EXISTS status_checks (
  checked_at INTEGER NOT NULL,
  ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
  -- Compact failing-service list (`''`/`ok` when healthy); never arbitrary
  -- user input, so it can be rendered directly as text.
  detail TEXT
);

-- The history query is `WHERE checked_at >= ? ORDER BY checked_at`, so the
-- ascending index also serves the "latest row" throttle lookup.
CREATE INDEX IF NOT EXISTS idx_status_checks_checked_at ON status_checks(checked_at);
