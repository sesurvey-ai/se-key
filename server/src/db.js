import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.SE_KEY_DB || path.join(__dirname, '..', 'data.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS records (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    claim_no     TEXT NOT NULL,
    survey_no    TEXT NOT NULL DEFAULT '',
    keyer        TEXT NOT NULL DEFAULT '',
    work_type    TEXT NOT NULL DEFAULT '',
    invoice_mix  TEXT NOT NULL DEFAULT '',
    isurvey_sent INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_records_claim_no  ON records(claim_no);
CREATE INDEX IF NOT EXISTS idx_records_survey_no ON records(survey_no);
CREATE INDEX IF NOT EXISTS idx_records_created   ON records(created_at);
CREATE INDEX IF NOT EXISTS idx_records_pending   ON records(isurvey_sent, work_type);
`;

// Run at module load so any file that imports `db` and does `db.prepare(...)`
// at the top level sees the new columns. ALTER TABLE has no IF NOT EXISTS
// in SQLite; we feature-check via PRAGMA.
db.exec(SCHEMA);
{
  const cols = new Set(
    db.prepare('PRAGMA table_info(records)').all().map((c) => c.name)
  );
  if (!cols.has('retry_count')) {
    db.exec('ALTER TABLE records ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.has('last_retry_at')) {
    db.exec('ALTER TABLE records ADD COLUMN last_retry_at TEXT');
  }
  if (!cols.has('retry_error')) {
    db.exec('ALTER TABLE records ADD COLUMN retry_error TEXT');
  }
}

// Kept as an exported no-op so existing call sites don't need updating.
export function initSchema() { /* already done at import */ }
