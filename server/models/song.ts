import db from '../db';

export interface Song {
  id: string;
  title: string;
  fileData: string;
  mimeType: string;
  duration: number;
  size: number;
  createdAt: number;
  createdBy: string;
}

export function getAllSongs(): Song[] {
  const rows = db.prepare('SELECT * FROM songs ORDER BY created_at DESC').all();
  return rows.map((r: any) => ({
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

export function getSongIds(): string[] {
  return db.prepare('SELECT id FROM songs').all().map((r: any) => r.id);
}

export function getSongById(id: string): Song | null {
  const r: any = db.prepare('SELECT * FROM songs WHERE id = ?').get(id);
  if (!r) return null;
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

export function saveSong(song: Song): void {
  db.prepare(`
    INSERT OR REPLACE INTO songs (id, title, file_data, mime_type, duration, size, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(song.id, song.title, song.fileData, song.mimeType, song.duration, song.size, song.createdAt, song.createdBy);
}

export function deleteSong(id: string): void {
  db.prepare('DELETE FROM songs WHERE id = ?').run(id);
}
