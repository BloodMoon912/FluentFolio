CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  visitor_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_visits_created_at ON visits(created_at);
CREATE INDEX IF NOT EXISTS idx_visits_hash ON visits(visitor_hash);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  details TEXT,
  state TEXT,
  image TEXT,
  started_at INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO activity(id,type,name,details,state,image,started_at) VALUES
(1,'coding','Personal Fluent Site','Redesigning the personal dashboard','Astro + Cloudflare Workers','/activities/default.svg',strftime('%s','now') * 1000);
