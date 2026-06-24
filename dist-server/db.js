"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const DB_DIR = process.env.DB_DIR || path_1.default.join(process.cwd(), 'data');
if (!fs_1.default.existsSync(DB_DIR))
    fs_1.default.mkdirSync(DB_DIR, { recursive: true });
const db = new better_sqlite3_1.default(path_1.default.join(DB_DIR, 'syncwave.db'));
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
exports.default = db;
