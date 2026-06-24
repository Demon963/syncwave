import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import cors from 'cors';
import fs from 'fs';
import { getAllSongs, saveSong, deleteSong, getSongById } from './models/song';
import { syncManager } from './sync';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Ensure uploads directory exists
const uploadsDir = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// -- REST API: Songs --

// Get all songs
app.get('/api/songs', (req, res) => {
  try {
    const songs = getAllSongs();
    res.json(songs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch songs' });
  }
});

// Get single song
app.get('/api/songs/:id', (req, res) => {
  try {
    const song = getSongById(req.params.id);
    if (!song) return res.status(404).json({ error: 'Song not found' });
    res.json(song);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch song' });
  }
});

// Upload song (base64 in JSON body)
app.post('/api/songs', (req, res) => {
  try {
    const { id, title, fileData, mimeType, duration, size, createdBy } = req.body;
    if (!id || !title || !fileData || !mimeType || !size) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const song = {
      id,
      title,
      fileData,
      mimeType,
      duration: duration || 0,
      size,
      createdAt: Date.now(),
      createdBy: createdBy || 'admin',
    };
    saveSong(song);
    res.json({ success: true, song });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save song' });
  }
});

// Delete song
app.delete('/api/songs/:id', (req, res) => {
  try {
    deleteSong(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete song' });
  }
});

// Get song count
app.get('/api/songs/count', (req, res) => {
  try {
    const songs = getAllSongs();
    res.json({ count: songs.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to count songs' });
  }
});

// -- WebSocket --

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const clientId = url.searchParams.get('id') || `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const role = url.searchParams.get('role') as 'admin' | 'listener' || 'listener';
  const roomId = url.searchParams.get('room') || 'default';

  syncManager.addClient(ws, clientId, role, roomId);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      syncManager.handleMessage(clientId, msg);
    } catch (e) {
      // ignore invalid messages
    }
  });

  ws.on('close', () => {
    syncManager.removeClient(clientId);
  });

  // Send welcome message
  ws.send(JSON.stringify({ type: 'welcome', clientId }));
});

// -- Serve Frontend (in production) --
const distPath = path.join(process.cwd(), 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// -- Start --
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[SyncWave] Server running on port ${PORT}`);
  console.log(`[SyncWave] WebSocket on ws://localhost:${PORT}/ws`);
});
