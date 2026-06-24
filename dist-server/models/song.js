"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllSongs = getAllSongs;
exports.getSongIds = getSongIds;
exports.getSongById = getSongById;
exports.saveSong = saveSong;
exports.deleteSong = deleteSong;
const db_1 = __importDefault(require("../db"));
function getAllSongs() {
    const rows = db_1.default.prepare('SELECT * FROM songs ORDER BY created_at DESC').all();
    return rows.map((r) => ({
        id: r.id,
        title: r.title,
        fileData: r.file_data,
        mimeType: r.mime_type,
        duration: r.duration,
        size: r.size,
        createdAt: r.created_at,
        createdBy: r.created_by,
    }));
}
function getSongIds() {
    return db_1.default.prepare('SELECT id FROM songs').all().map((r) => r.id);
}
function getSongById(id) {
    const r = db_1.default.prepare('SELECT * FROM songs WHERE id = ?').get(id);
    if (!r)
        return null;
    return {
        id: r.id,
        title: r.title,
        fileData: r.file_data,
        mimeType: r.mime_type,
        duration: r.duration,
        size: r.size,
        createdAt: r.created_at,
        createdBy: r.created_by,
    };
}
function saveSong(song) {
    db_1.default.prepare(`
    INSERT OR REPLACE INTO songs (id, title, file_data, mime_type, duration, size, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(song.id, song.title, song.fileData, song.mimeType, song.duration, song.size, song.createdAt, song.createdBy);
}
function deleteSong(id) {
    db_1.default.prepare('DELETE FROM songs WHERE id = ?').run(id);
}
