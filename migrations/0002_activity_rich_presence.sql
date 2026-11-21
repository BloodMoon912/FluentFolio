ALTER TABLE activity ADD COLUMN large_image TEXT;
ALTER TABLE activity ADD COLUMN large_text TEXT;
ALTER TABLE activity ADD COLUMN small_image TEXT;
ALTER TABLE activity ADD COLUMN small_text TEXT;
ALTER TABLE activity ADD COLUMN buttons TEXT NOT NULL DEFAULT '[]';
