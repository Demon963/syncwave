import { WebSocket } from 'ws';

export interface SyncCmd {
  type: 'cmd';
  action: 'play' | 'pause' | 'seek' | 'track';
  songId: string;
  time: number;
  timestamp: number;
  adminTime?: number;
}

interface Client {
  ws: WebSocket;
  id: string;
  role: 'admin' | 'listener';
  roomId: string;
  latency: number;
}

class SyncManager {
  private clients: Map<string, Client> = new Map();
  private rooms: Map<string, Set<string>> = new Map();

  addClient(ws: WebSocket, id: string, role: 'admin' | 'listener', roomId: string) {
    const client: Client = { ws, id, role, roomId, latency: 100 };
    this.clients.set(id, client);
    if (!this.rooms.has(roomId)) this.rooms.set(roomId, new Set());
    this.rooms.get(roomId)!.add(id);

    if (role === 'listener') {
      this.notifyAdmin(roomId, { type: 'listenerJoined', listenerId: id });
    }
  }

  removeClient(id: string) {
    const client = this.clients.get(id);
    if (client) {
      this.rooms.get(client.roomId)?.delete(id);
      if (this.rooms.get(client.roomId)?.size === 0) this.rooms.delete(client.roomId);
      if (client.role === 'listener') {
        this.notifyAdmin(client.roomId, { type: 'listenerLeft', listenerId: id });
      }
      this.clients.delete(id);
    }
  }

  broadcastToRoom(roomId: string, message: any, excludeId?: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.forEach(clientId => {
      if (clientId === excludeId) return;
      const client = this.clients.get(clientId);
      if (client?.ws.readyState === 1) {
        client.ws.send(JSON.stringify(message));
      }
    });
  }

  notifyAdmin(roomId: string, message: any) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.forEach(clientId => {
      const client = this.clients.get(clientId);
      if (client?.role === 'admin' && client.ws.readyState === 1) {
        client.ws.send(JSON.stringify(message));
      }
    });
  }

  getListenerCount(roomId: string): number {
    const room = this.rooms.get(roomId);
    if (!room) return 0;
    let count = 0;
    room.forEach(clientId => {
      if (this.clients.get(clientId)?.role === 'listener') count++;
    });
    return count;
  }

  handleMessage(clientId: string, message: any) {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (message.type) {
      case 'cmd': {
        if (client.role === 'admin') {
          const cmd: SyncCmd = {
            type: 'cmd',
            action: message.action,
            songId: message.songId,
            time: message.time,
            timestamp: Date.now(),
            adminTime: message.adminTime,
          };
          this.broadcastToRoom(client.roomId, cmd, clientId);
        }
        break;
      }
      case 'ping': {
        client.ws.send(JSON.stringify({ type: 'pong', t: message.t, serverT: Date.now() }));
        break;
      }
      case 'pong': {
        const rtt = Date.now() - message.t;
        client.latency = Math.round(rtt / 2);
        break;
      }
      case 'requestSongs': {
        if (client.role === 'listener') {
          this.notifyAdmin(client.roomId, { type: 'listenerRequestSongs', listenerId: clientId });
        }
        break;
      }
      case 'newSong': {
        if (client.role === 'admin') {
          this.broadcastToRoom(client.roomId, { type: 'newSong', song: message.song }, clientId);
        }
        break;
      }
    }
  }
}

export const syncManager = new SyncManager();
