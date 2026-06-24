/**
 * SyncWave P2P — Ultra Simple v3.2
 * One fixed room. Admin = broadcaster. Listener = auto-connects.
 */

import type { Song } from './db';

const PEERJS_CDN = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';
export const FIXED_ROOM_ID = 'syncwave-room-1';
const ADMIN_PASSWORD = '123';

// ─── Types ──────────────────────────────────────────────

export type SyncCmd = {
  type: 'cmd';
  action: 'play' | 'pause' | 'seek' | 'track';
  songId: string;
  time: number;
  ts: number;
};

export type SyncMessage =
  | { type: 'requestSync'; knownIds: string[] }
  | { type: 'syncSongs'; songs: Song[] }
  | { type: 'syncConfirm'; ids: string[] }
  | { type: 'newSong'; song: Song }
  | SyncCmd
  | { type: 'ping'; t: number }
  | { type: 'pong'; t: number; serverT: number };

export interface ListenerInfo {
  id: string;
  conn: any;
  latency: number;
  songs: Set<string>;
  status: 'syncing' | 'ready';
}

// ─── Helpers ────────────────────────────────────────────

function loadPeerJS(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).Peer) { resolve(); return; }
    const s = document.createElement('script');
    s.src = PEERJS_CDN;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('PeerJS load failed'));
    document.head.appendChild(s);
  });
}

export function verifyAdminPassword(input: string): boolean {
  return input === ADMIN_PASSWORD;
}

// ─── Time Sync ──────────────────────────────────────────

export function getSyncedTime(cmd: { time: number; ts: number }): number {
  const delay = Math.max(0, (Date.now() - cmd.ts) / 2000);
  return Math.max(0, cmd.time + delay);
}

// ─── Admin ──────────────────────────────────────────────

export class AdminSync {
  private peer: any;
  private listeners: Map<string, ListenerInfo> = new Map();
  private onStateChangeCb?: () => void;
  private onNewListenerCb?: (info: ListenerInfo) => void;
  public peerId: string = FIXED_ROOM_ID;
  public state: 'connecting' | 'ready' | 'error' = 'connecting';
  private PeerClass: any;

  constructor() {
    this.PeerClass = (window as any).Peer;
    if (!this.PeerClass) {
      loadPeerJS().then(() => {
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

  private initPeer() {
    try {
      this.peer = new this.PeerClass(FIXED_ROOM_ID);
      this.peer.on('open', () => {
        this.state = 'ready';
        this.onStateChangeCb?.();
      });
      this.peer.on('connection', (conn: any) => this.handleConnection(conn));
      this.peer.on('error', (err: any) => {
        console.error('[Admin] Peer error:', err);
        if (err.type === 'unavailable-id') {
          // Another admin is already using this ID, wait and retry
          setTimeout(() => this.initPeer(), 2000);
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
      latency: 50,
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
      switch (msg.type) {
        case 'requestSync': {
          info.songs = new Set(msg.knownIds);
          info.status = 'syncing';
          this.onNewListenerCb?.(info);
          break;
        }
        case 'syncConfirm': {
          msg.ids.forEach(id => info.songs.add(id));
          info.status = 'ready';
          this.onStateChangeCb?.();
          break;
        }
        case 'pong': {
          const rtt = Date.now() - msg.t;
          info.latency = Math.round(rtt / 2);
          break;
        }
      }
    });

    conn.on('close', () => {
      this.listeners.delete(conn.peer);
      this.onStateChangeCb?.();
    });

    conn.on('error', () => {
      this.listeners.delete(conn.peer);
      this.onStateChangeCb?.();
    });
  }

  private measureLatency(info: ListenerInfo) {
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        if (info.conn.open) {
          info.conn.send({ type: 'ping', t: Date.now() });
        }
      }, i * 500);
    }
  }

  sendSongs(listenerId: string, songs: Song[]) {
    const info = this.listeners.get(listenerId);
    if (!info?.conn.open) return;
    const newSongs = songs.filter(s => !info.songs.has(s.id));
    if (newSongs.length === 0) {
      info.conn.send({ type: 'syncSongs', songs: [] });
      info.status = 'ready';
      this.onStateChangeCb?.();
      return;
    }
    let i = 0;
    const send = () => {
      if (i >= newSongs.length || !info.conn.open) {
        info.status = 'ready';
        this.onStateChangeCb?.();
        return;
      }
      info.conn.send({ type: 'syncSongs', songs: [newSongs[i]] });
      info.songs.add(newSongs[i].id);
      i++;
      setTimeout(send, 80);
    };
    send();
  }

  broadcastNewSong(song: Song) {
    this.listeners.forEach(info => {
      if (info.conn.open && !info.songs.has(song.id)) {
        info.conn.send({ type: 'newSong', song });
        info.songs.add(song.id);
      }
    });
  }

  sendCommand(action: 'play' | 'pause' | 'seek' | 'track', songId: string, time: number) {
    const cmd: SyncCmd = { type: 'cmd', action, songId, time, ts: Date.now() };
    this.listeners.forEach(info => {
      if (info.conn.open) {
        // Compensate per-listener latency
        const adjusted: SyncCmd = { ...cmd, ts: Date.now() - info.latency };
        info.conn.send(adjusted);
      }
    });
  }

  getListenerCount(): number {
    return Array.from(this.listeners.values()).filter(l => l.conn.open).length;
  }

  getListenerIds(): string[] {
    return Array.from(this.listeners.values()).filter(l => l.conn.open).map(l => l.id);
  }

  onStateChange(cb: () => void) { this.onStateChangeCb = cb; }
  onNewListener(cb: (info: ListenerInfo) => void) { this.onNewListenerCb = cb; }

  destroy() {
    this.listeners.forEach(l => l.conn.close());
    this.peer?.destroy();
  }
}

// ─── Listener ───────────────────────────────────────────

export class ListenerSync {
  private peer: any;
  private adminConn: any = null;
  public state: 'connecting' | 'syncing' | 'ready' | 'error' | 'disconnected' = 'connecting';
  public latency: number = 50;
  private onSongCb?: (song: Song) => void;
  private onCmdCb?: (cmd: SyncCmd) => void;
  private onStateChangeCb?: () => void;
  private PeerClass: any;

  constructor() {
    this.PeerClass = (window as any).Peer;
  }

  async connect(knownSongIds: string[]) {
    this.state = 'connecting';
    this.onStateChangeCb?.();

    try {
      if (!this.PeerClass) {
        await loadPeerJS();
        this.PeerClass = (window as any).Peer;
      }

      this.peer = new this.PeerClass();

      this.peer.on('open', () => {
        const conn = this.peer.connect(FIXED_ROOM_ID, { reliable: true });
        this.adminConn = conn;

        conn.on('open', () => {
          this.state = 'syncing';
          this.onStateChangeCb?.();
          // Measure latency
          this.runLatencyProbe();
          // Request songs
          setTimeout(() => {
            conn.send({ type: 'requestSync', knownIds: knownSongIds });
          }, 300);
        });

        conn.on('data', (msg: SyncMessage) => {
          this.handleMessage(msg);
        });

        conn.on('close', () => {
          this.state = 'disconnected';
          this.onStateChangeCb?.();
          // Auto-reconnect after 3 seconds
          setTimeout(() => {
            if (this.state === 'disconnected') {
              this.connect(knownSongIds);
            }
          }, 3000);
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

  private async runLatencyProbe() {
    const latencies: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      if (!this.adminConn?.open) return;
      this.adminConn.send({ type: 'ping', t: t0 });
      
      // Wait for pong (handled in handleMessage)
      await new Promise(r => setTimeout(r, 400));
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
        this.adminConn?.send({ type: 'pong', t: msg.t, serverT: Date.now() });
        break;
      }
      case 'pong': {
        const rtt = Date.now() - msg.t;
        this.latency = Math.round(rtt / 2);
        break;
      }
    }
  }

  onSong(cb: (song: Song) => void) { this.onSongCb = cb; }
  onCmd(cb: (cmd: SyncCmd) => void) { this.onCmdCb = cb; }
  onStateChange(cb: () => void) { this.onStateChangeCb = cb; }

  disconnect() {
    this.adminConn?.close();
    this.peer?.destroy();
    this.state = 'disconnected';
  }
}
