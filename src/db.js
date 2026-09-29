import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  warnings INTEGER NOT NULL DEFAULT 0,
  watchlisted INTEGER NOT NULL DEFAULT 0,
  watch_reason TEXT,
  privacy_agreed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 벤 파이프라인: 정지된 계정의 가입 정보(아이디)는 다시 가입할 수 없다.
CREATE TABLE IF NOT EXISTS banned_usernames (
  username TEXT PRIMARY KEY COLLATE NOCASE,
  reason TEXT,
  banned_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  finder_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  public_description TEXT NOT NULL DEFAULT '',
  found_place TEXT NOT NULL,
  found_at TEXT NOT NULL,
  custody TEXT NOT NULL CHECK (custody IN ('finder', 'institution')),
  institution_name TEXT,
  institution_location TEXT,
  institution_contact TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'matched', 'returned')),
  ai_mode TEXT NOT NULL DEFAULT 'heuristic',
  created_at TEXT NOT NULL,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS items_status_published ON items(status, published_at);

-- 습득물 사진은 공개하지 않는다. 습득자 본인과 AI만 본다.
CREATE TABLE IF NOT EXISTS item_photos (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS item_features (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  kind TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
  source TEXT NOT NULL CHECK (source IN ('finder', 'ai', 'both'))
);

CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  claimant_id INTEGER NOT NULL REFERENCES users(id),
  answer_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('followup', 'awaiting_finder', 'failed', 'approved', 'rejected', 'closed')),
  narrative_score INTEGER NOT NULL,
  evidence_bonus INTEGER NOT NULL DEFAULT 0,
  total_score INTEGER NOT NULL,
  matched_feature_ids TEXT NOT NULL DEFAULT '[]',
  wrong_count INTEGER NOT NULL DEFAULT 0,
  statements TEXT NOT NULL DEFAULT '[]',
  evidence_kind TEXT NOT NULL DEFAULT 'none',
  evidence_note TEXT,
  ai_suspected INTEGER NOT NULL DEFAULT 0,
  followup_questions TEXT,
  followup_answers TEXT,
  ai_mode TEXT NOT NULL DEFAULT 'heuristic',
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS claims_item ON claims(item_id);
CREATE INDEX IF NOT EXISTS claims_claimant ON claims(claimant_id, created_at);

CREATE TABLE IF NOT EXISTS claim_evidence (
  id INTEGER PRIMARY KEY,
  claim_id INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_rooms (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id),
  claim_id INTEGER NOT NULL UNIQUE REFERENCES claims(id),
  finder_id INTEGER NOT NULL REFERENCES users(id),
  claimant_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  link TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
`;

export function openDb(filename) {
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON;');
  if (filename !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function now() {
  return new Date().toISOString();
}
