import { Database } from "bun:sqlite";
import { join } from "path";

const DB_PATH = join(import.meta.dir, "..", "data", "db", "meetings.db");

const db = new Database(DB_PATH, { create: true, strict: true });
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS voice_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      notes TEXT
  );

  CREATE TABLE IF NOT EXISTS meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_name TEXT NOT NULL,
      mp3_path TEXT NOT NULL,
      transcript_path TEXT,
      language TEXT NOT NULL DEFAULT 'es',
      meeting_date TEXT NOT NULL,
      processed_at TEXT,
      duration_seconds INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      title TEXT
  );

  CREATE TABLE IF NOT EXISTS voice_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES voice_profiles(id) ON DELETE CASCADE,
      embedding BLOB NOT NULL,
      source_meeting_id INTEGER REFERENCES meetings(id),
      quality_score REAL,
      clip_duration_seconds REAL,
      segment_count INTEGER,
      clean_segment_count INTEGER,
      has_overlap INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS meeting_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      profile_id INTEGER REFERENCES voice_profiles(id),
      speaker_label TEXT NOT NULL,
      is_identified INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS unknown_speakers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      speaker_label TEXT NOT NULL,
      embedding BLOB NOT NULL,
      clip_path TEXT,
      quality_score REAL,
      clip_duration_seconds REAL,
      segment_count INTEGER,
      clean_segment_count INTEGER,
      has_overlap INTEGER NOT NULL DEFAULT 0,
      assigned_profile_id INTEGER REFERENCES voice_profiles(id),
      status TEXT NOT NULL DEFAULT 'pending'
  );

  CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#6b7280',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS meeting_tags (
      meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (meeting_id, tag_id)
  );

  CREATE INDEX IF NOT EXISTS idx_voice_embeddings_profile ON voice_embeddings(profile_id);
  CREATE INDEX IF NOT EXISTS idx_meeting_participants_meeting ON meeting_participants(meeting_id);
  CREATE INDEX IF NOT EXISTS idx_unknown_speakers_meeting ON unknown_speakers(meeting_id);
  CREATE INDEX IF NOT EXISTS idx_unknown_speakers_status ON unknown_speakers(status);
  CREATE INDEX IF NOT EXISTS idx_meeting_tags_tag ON meeting_tags(tag_id);
  CREATE INDEX IF NOT EXISTS idx_meeting_tags_meeting ON meeting_tags(meeting_id);
`);

// Migrations for existing databases
try {
  db.exec(`ALTER TABLE meetings ADD COLUMN error_message TEXT`);
} catch {
  // Column already exists
}

const migrations = [
  `ALTER TABLE meeting_participants ADD COLUMN clip_path TEXT`,
  `ALTER TABLE voice_embeddings ADD COLUMN quality_score REAL`,
  `ALTER TABLE voice_embeddings ADD COLUMN clip_duration_seconds REAL`,
  `ALTER TABLE voice_embeddings ADD COLUMN segment_count INTEGER`,
  `ALTER TABLE voice_embeddings ADD COLUMN clean_segment_count INTEGER`,
  `ALTER TABLE voice_embeddings ADD COLUMN has_overlap INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE unknown_speakers ADD COLUMN quality_score REAL`,
  `ALTER TABLE unknown_speakers ADD COLUMN clip_duration_seconds REAL`,
  `ALTER TABLE unknown_speakers ADD COLUMN segment_count INTEGER`,
  `ALTER TABLE unknown_speakers ADD COLUMN clean_segment_count INTEGER`,
  `ALTER TABLE unknown_speakers ADD COLUMN has_overlap INTEGER NOT NULL DEFAULT 0`,
];

for (const migration of migrations) {
  try {
    db.exec(migration);
  } catch {
    // Column already exists
  }
}

export { db };
