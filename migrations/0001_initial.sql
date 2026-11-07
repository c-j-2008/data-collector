CREATE TABLE IF NOT EXISTS research_profiles (
  browser_uuid TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  browser_uuid TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  location_status TEXT NOT NULL,
  ip_address TEXT,
  consent_status INTEGER NOT NULL CHECK (consent_status IN (0, 1)),
  submitted_at TEXT NOT NULL,
  FOREIGN KEY (browser_uuid) REFERENCES research_profiles(browser_uuid)
);

CREATE INDEX IF NOT EXISTS idx_submissions_timestamp ON research_submissions(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_uuid ON research_submissions(browser_uuid);
