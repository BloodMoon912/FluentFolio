ALTER TABLE visits ADD COLUMN country TEXT;
ALTER TABLE visits ADD COLUMN referrer_host TEXT;
CREATE INDEX IF NOT EXISTS idx_visits_country ON visits(country);
CREATE INDEX IF NOT EXISTS idx_visits_referrer ON visits(referrer_host);
