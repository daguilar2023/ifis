CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  pdf_key TEXT NOT NULL,
  thumb_key TEXT,
  pdf_filename TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_publications_created_at ON publications(created_at DESC);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL,
  locked_until TEXT
);

CREATE TABLE IF NOT EXISTS csrf_tokens (
  token TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
