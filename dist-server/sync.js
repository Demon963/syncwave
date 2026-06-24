"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncManager = void 0;
class SyncManager {
    clients = new Map();
    rooms = new Map();
    addClient(ws, id, role, roomId) {
        const client = { ws, id, role, roomId, latency: 100 };
        this.clients.set(id, client);
        if (!this.rooms.has(roomId))
            this.rooms.set(roomId, new Set());
        this.rooms.get(roomId).add(id);
        if (role === 'listener') {
            this.notifyAdmin(roomId, { type: 'listenerJoined', listenerId: id });
        }
    }
    removeClient(id) {
        const client = this.clients.get(id);
        if (client) {
            this.rooms.get(client.roomId)?.delete(id);
            if (this.rooms.get(client.roomId)?.size === 0)
                this.rooms.delete(client.roomId);
            if (client.role === 'listener') {
                this.notifyAdmin(client.roomId, { type: 'listenerLeft', listenerId: id });
            }
            this.clients.delete(id);
        }
    }
    broadcastToRoom(roomId, message, excludeId) {
        const room = this.rooms.get(roomId);
        if (!room)
            return;
        room.forEach(clientId => {
            if (clientId === excludeId)
                return;
            const client = this.clients.get(clientId);
            if (client?.ws.readyState === 1) {
                client.ws.send(JSON.stringify(message));
            }
        });
    }
    notifyAdmin(roomId, message) {
        const room = this.rooms.get(roomId);
        if (!room)
            return;
        room.forEach(clientId => {
            const client = this.clients.get(clientId);
            if (client?.role === 'admin' && client.ws.readyState === 1) {
                client.ws.send(JSON.stringify(message));
            }
        });
    }
    getListenerCount(roomId) {
        const room = this.rooms.get(roomId);
        if (!room)
            return 0;
        let count = 0;
        room.forEach(clientId => {
            if (this.clients.get(clientId)?.role === 'listener')
                count++;
        });
        return count;
    }
    handleMessage(clientId, message) {
        const client = this.clients.get(clientId);
        if (!client)
            return;
        switch (message.type) {
            case 'cmd': {
                if (client.role === 'admin') {
                    const cmd = {
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
exports.syncManager = new SyncManager();
