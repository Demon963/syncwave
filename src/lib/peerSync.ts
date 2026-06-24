/**
 * SyncWave P2P Sync Engine using PeerJS Cloud
 * - Admin creates a Peer (broadcaster)
 * - Listeners connect via peer.connect(adminPeerId)
 * - Songs synced via data connection
 * - Commands (play/pause/seek/track) synced with latency compensation
 */

import type { Song } from './db';

// ─── Types ──────────────────────────────────────────────

export type SyncCmd = {
  type: 'cmd';
  action: 'play' | 'pause' | 'seek' | 'track';
  songId: string;
  time: number;
  timestamp: number;  // sender timestamp for sync
};

export type SyncMessage =
  | { type: 'requestSync'; knownIds: string[] }
  | { type: 'syncSongs'; songs: Song[] }
  | { type: 'syncConfirm'; ids: string[] }
  | { type: 'newSong'; song: Song }
  | SyncCmd
  | { type: 'ping'; t: number }
  | { type: 'pong'; t: number; senderT: number };

export interface ListenerInfo {
  id: string;
  conn: any;
  latency: number;
  songs: Set<string>;
  status: 'syncing' | 'ready' | 'error';
}

// ─── Admin Side ─────────────────────────────────────────

export class AdminSync {
  private peer: any;
  private listeners: Map<string, ListenerInfo> = new Map();
  private onStateChangeCb?: () => void;
  private onNewListenerCb?: (info: ListenerInfo) => void;
  public peerId: string = '';
  public state: 'connecting' | 'ready' | 'error' = 'connecting';
  private PeerClass: any;

  constructor() {
    this.PeerClass = (window as any).Peer;
    if (!this.PeerClass) {
      // Load PeerJS script dynamically
      this.loadPeerJS().then(() => {
        this.PeerClass = (window as any).Peer;
        this.initPeer();
      }).catch(() => {
        this.state = 'error';
        this.onStateChangeCb?.();
      });
    } else {
      this.initPeer();
    }
  }

  private loadPeerJS(): Promise<void> {
    return new Promise((resolve, reject) => {
      if ((window as any).Peer) { resolve(); return; }
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load PeerJS'));
      document.head.appendChild(script);
    });
  }

  private initPeer() {
    try {
      this.peer = new this.PeerClass();
      this.peer.on('open', (id: string) => {
        this.peerId = id;
        this.state = 'ready';
        this.onStateChangeCb?.();
      });
      this.peer.on('connection', (conn: any) => this.handleConnection(conn));
      this.peer.on('error', (err: any) => {
        console.error('[Admin] Peer error:', err);
        if (err.type === 'unavailable-id') {
          setTimeout(() => this.initPeer(), 1000);
          return;
        }
        this.state = 'error';
        this.onStateChangeCb?.();
      });
    } catch (e) {
      this.state = 'error';
      this.onStateChangeCb?.();
    }
  }

  private handleConnection(conn: any) {
    const info: ListenerInfo = {
      id: conn.peer,
      conn,
      latency: 100,
      songs: new Set(),
      status: 'syncing',
    };
    this.listeners.set(conn.peer, info);

    conn.on('open', () => {
      this.measureLatency(info);
      this.onNewListenerCb?.(info);
      this.onStateChangeCb?.();
    });

    conn.on('data', (msg: SyncMessage) => {
      this.handleMessage(info, msg);
    });

    conn.on('close', () => {
      this.listeners.delete(conn.peer);
      this.onStateChangeCb?.();
    });

    conn.on('error', () => {
      info.status = 'error';
      this.onStateChangeCb?.();
    });
  }

  private handleMessage(info: ListenerInfo, msg: SyncMessage) {
    switch (msg.type) {
      case 'requestSync': {
        info.songs = new Set(msg.knownIds);
        info.status = 'syncing';
        // Emit sync request — Admin should respond with songs
        this.emit('syncNeeded', { listenerId: info.id, knownIds: msg.knownIds });
        break;
      }
      case 'syncConfirm': {
        msg.ids.forEach(id => info.songs.add(id));
        if (info.status === 'syncing') {
          info.status = 'ready';
        }
        this.onStateChangeCb?.();
        break;
      }
      case 'pong': {
        const rtt = Date.now() - msg.t;
        info.latency = Math.round(rtt / 2);
        break;
      }
    }
  }

  private measureLatency(info: ListenerInfo) {
    const ping = () => {
      if (!info.conn.open) return;
      info.conn.send({ type: 'ping', t: Date.now() });
    };
    ping();
    setTimeout(ping, 2000);
    setTimeout(ping, 5000);
  }

  // Send songs incrementally
  sendSongs(listenerId: string, songs: Song[]) {
    const info = this.listeners.get(listenerId);
    if (!info || !info.conn.open) return;
    const newSongs = songs.filter(s => !info.songs.has(s.id));
    if (newSongs.length === 0) {
      info.conn.send({ type: 'syncSongs', songs: [] });
      info.status = 'ready';
      this.onStateChangeCb?.();
      return;
    }
    // Send in batches
    const batchSize = 1;
    let index = 0;
    const sendBatch = () => {
      if (index >= newSongs.length || !info.conn.open) return;
      const batch = newSongs.slice(index, index + batchSize);
      info.conn.send({ type: 'syncSongs', songs: batch });
      batch.forEach(s => info.songs.add(s.id));
      index += batchSize;
      setTimeout(sendBatch, 100);
    };
    sendBatch();
  }

  // Broadcast new song to all listeners
  broadcastNewSong(song: Song) {
    this.listeners.forEach(info => {
      if (info.conn.open && !info.songs.has(song.id)) {
        info.conn.send({ type: 'newSong', song });
        info.songs.add(song.id);
      }
    });
  }

  // Send playback command with time sync
  sendCommand(action: 'play' | 'pause' | 'seek' | 'track', songId: string, time: number) {
    const cmd: SyncCmd = {
      type: 'cmd',
      action,
      songId,
      time,
      timestamp: Date.now(),
    };
    this.listeners.forEach(info => {
      if (info.conn.open) {
        info.conn.send(cmd);
      }
    });
  }

  getListenerCount(): number {
    return Array.from(this.listeners.values()).filter(l => l.conn.open).length;
  }

  onStateChange(cb: () => void) { this.onStateChangeCb = cb; }
  onNewListener(cb: (info: ListenerInfo) => void) { this.onNewListenerCb = cb; }
  emit(event: string, data?: any) { /* placeholder */ }

  destroy() {
    this.listeners.forEach(l => l.conn.close());
    this.peer?.destroy();
  }
}

// ─── Listener Side ──────────────────────────────────────

export class ListenerSync {
  private peer: any;
  private adminConn: any = null;
  public state: 'connecting' | 'syncing' | 'ready' | 'error' = 'connecting';
  public latency: number = 100;
  private onSongCb?: (song: Song) => void;
  private onCmdCb?: (cmd: SyncCmd) => void;
  private onStateChangeCb?: () => void;
  private PeerClass: any;

  constructor() {
    this.PeerClass = (window as any).Peer;
  }

  private loadPeerJS(): Promise<void> {
    return new Promise((resolve, reject) => {
      if ((window as any).Peer) { resolve(); return; }
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load PeerJS'));
      document.head.appendChild(script);
    });
  }

  async connect(adminPeerId: string, knownSongIds: string[]) {
    this.state = 'connecting';
    this.onStateChangeCb?.();

    try {
      if (!this.PeerClass) {
        await this.loadPeerJS();
        this.PeerClass = (window as any).Peer;
      }

      this.peer = new this.PeerClass();

      this.peer.on('open', () => {
        const conn = this.peer.connect(adminPeerId, { reliable: true });
        this.adminConn = conn;

        conn.on('open', () => {
          this.state = 'syncing';
          this.onStateChangeCb?.();
          // Request songs we don't have
          conn.send({ type: 'requestSync', knownIds: knownSongIds });
          // Start ping-pong for latency
          this.startPingLoop();
        });

        conn.on('data', (msg: SyncMessage) => {
          this.handleMessage(msg);
        });

        conn.on('close', () => {
          this.state = 'disconnected' as any;
          this.onStateChangeCb?.();
        });

        conn.on('error', () => {
          this.state = 'error';
          this.onStateChangeCb?.();
        });
      });

      this.peer.on('error', (err: any) => {
        console.error('[Listener] Peer error:', err);
        this.state = 'error';
        this.onStateChangeCb?.();
      });
    } catch (e) {
      this.state = 'error';
      this.onStateChangeCb?.();
    }
  }

  private handleMessage(msg: SyncMessage) {
    switch (msg.type) {
      case 'syncSongs': {
        if (msg.songs.length === 0) {
          this.state = 'ready';
        } else {
          msg.songs.forEach(song => this.onSongCb?.(song));
          const ids = msg.songs.map(s => s.id);
          this.adminConn?.send({ type: 'syncConfirm', ids });
        }
        this.onStateChangeCb?.();
        break;
      }
      case 'newSong': {
        this.onSongCb?.(msg.song);
        break;
      }
      case 'cmd': {
        this.onCmdCb?.(msg);
        break;
      }
      case 'ping': {
        this.adminConn?.send({ type: 'pong', t: msg.t, senderT: Date.now() });
        break;
      }
    }
  }

  private startPingLoop() {
    const loop = () => {
      if (!this.adminConn?.open) return;
      setTimeout(loop, 5000);
    };
    loop();
  }

  onSong(cb: (song: Song) => void) { this.onSongCb = cb; }
  onCmd(cb: (cmd: SyncCmd) => void) { this.onCmdCb = cb; }
  onStateChange(cb: () => void) { this.onStateChangeCb = cb; }

  disconnect() {
    this.adminConn?.close();
    this.peer?.destroy();
  }
}

// ─── Helper: Calculate synced playback time ──────────────────────

export function getSyncedTime(cmd: { time: number; timestamp: number }): number {
  const networkDelay = Math.max(0, (Date.now() - cmd.timestamp) / 1000);
  return Math.max(0, cmd.time + networkDelay * 0.3); // 30% of RTT as one-way delay
}
