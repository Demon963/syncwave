"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const ws_1 = require("ws");
const path_1 = __importDefault(require("path"));
const cors_1 = __importDefault(require("cors"));
const fs_1 = __importDefault(require("fs"));
const song_1 = require("./models/song");
const sync_1 = require("./sync");
const app = (0, express_1.default)();
const server = (0, http_1.createServer)(app);
const wss = new ws_1.WebSocketServer({ server, path: '/ws' });
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '50mb' }));
// Ensure uploads directory exists
const uploadsDir = process.env.UPLOADS_DIR || path_1.default.join(process.cwd(), 'uploads');
if (!fs_1.default.existsSync(uploadsDir))
    fs_1.default.mkdirSync(uploadsDir, { recursive: true });
// -- REST API: Songs --
// Get all songs
app.get('/api/songs', (req, res) => {
    try {
        const songs = (0, song_1.getAllSongs)();
        res.json(songs);
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to fetch songs' });
    }
});
// Get single song
app.get('/api/songs/:id', (req, res) => {
    try {
        const song = (0, song_1.getSongById)(req.params.id);
        if (!song)
            return res.status(404).json({ error: 'Song not found' });
        res.json(song);
    }
    catch (err) {
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
        (0, song_1.saveSong)(song);
        res.json({ success: true, song });
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to save song' });
    }
});
// Delete song
app.delete('/api/songs/:id', (req, res) => {
    try {
        (0, song_1.deleteSong)(req.params.id);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to delete song' });
    }
});
// Get song count
app.get('/api/songs/count', (req, res) => {
    try {
        const songs = (0, song_1.getAllSongs)();
        res.json({ count: songs.length });
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to count songs' });
    }
});
// -- WebSocket --
wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const clientId = url.searchParams.get('id') || `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const role = url.searchParams.get('role') || 'listener';
    const roomId = url.searchParams.get('room') || 'default';
    sync_1.syncManager.addClient(ws, clientId, role, roomId);
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            sync_1.syncManager.handleMessage(clientId, msg);
        }
        catch (e) {
            // ignore invalid messages
        }
    });
    ws.on('close', () => {
        sync_1.syncManager.removeClient(clientId);
    });
    // Send welcome message
    ws.send(JSON.stringify({ type: 'welcome', clientId }));
});
// -- Serve Frontend (in production) --
const distPath = path_1.default.join(process.cwd(), 'dist');
if (fs_1.default.existsSync(distPath)) {
    app.use(express_1.default.static(distPath));
    app.get('*', (req, res) => {
        res.sendFile(path_1.default.join(distPath, 'index.html'));
    });
}
// -- Start --
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[SyncWave] Server running on port ${PORT}`);
    console.log(`[SyncWave] WebSocket on ws://localhost:${PORT}/ws`);
});
