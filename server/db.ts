import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = process.env.DB_DIR || path.join(process.cwd(), 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'syncwave.db'));

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Create songs table
db.exec(`
  CREATE TABLE IF NOT EXISTS songs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    file_data TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    duration REAL DEFAULT 0,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    created_by TEXT DEFAULT 'admin'
  )
`);

// Create sessions table for WebSocket rooms
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    admin_peer_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    active INTEGER DEFAULT 1
  )
`);

export default db;
