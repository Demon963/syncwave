import express from 'express';
import { ExpressPeerServer } from 'peer';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const server = createServer(app);

// PeerServer as middleware on /peer path
const peerServer = ExpressPeerServer(server, {
  path: '/peer',
  allow_discovery: true,
  proxied: true,
});
app.use('/peer', peerServer);

// Serve static files (built React app)
app.use(express.static(join(__dirname, 'dist')));

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`SyncWave running on port ${PORT}`);
});
