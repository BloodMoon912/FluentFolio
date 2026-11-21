CREATE TABLE IF NOT EXISTS cms_drafts (
  slug TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cms_drafts_updated_at ON cms_drafts(updated_at);
