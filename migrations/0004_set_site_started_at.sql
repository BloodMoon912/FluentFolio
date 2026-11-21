-- Set the site's canonical runtime start to the first Git commit:
-- 2026-09-05T21:41:03+08:00 (1788615663000 ms since Unix epoch).
-- This makes the D1 runtime counter match the local Git-based value.
UPDATE activity
SET started_at = 1788615663000
WHERE id = 1;
