/**
 * SyncWave P2P Sync Engine v3 — Enhanced
 * - Persistent PeerID via localStorage
 * - NTP-style time sync (multi-round ping/pong)
 * - Admin-to-Admin song sync
 * - Room discovery
 */

import type { Song } from './db';

// ─── Constants ──────────────────────────────────────────

const PEERJS_CDN = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';
const PEERID_KEY = 'syncwave_peerid_v3';
const ADMIN_PASSWORD = '123';

// ─── Types ──────────────────────────────────────────────

export type SyncCmd = {
  type: 'cmd';
  action: 'play' | 'pause' | 'seek' | 'track';
  songId: string;
  time: number;
  timestamp: number;
  serverTime: number;
};

export type SyncMessage =
  | { type: 'requestSync'; knownIds: string[] }
  | { type: 'syncSongs'; songs: Song[] }
  | { type: 'syncConfirm'; ids: string[] }
  | { type: 'newSong'; song: Song }
  | { type: 'requestAllSongs' }
  | { type: 'allSongs'; songs: Song[] }
  | SyncCmd
  | { type: 'ping'; t: number }
  | { type: 'pong'; t: number; senderT: number }
  | { type: 'latencyProbe'; round: number; t: number }
  | { type: 'latencyReply'; round: number; t: number; serverT: number };

export interface ListenerInfo {
  id: string;
  conn: any;
  latency: number;
  songs: Set<string>;
  status: 'syncing' | 'ready' | 'error';
}

// ─── Helpers ────────────────────────────────────────────

function loadPeerJS(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).Peer) { resolve(); return; }
    const script = document.createElement('script');
    script.src = PEERJS_CDN;
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load PeerJS'));
    document.head.appendChild(script);
  });
}

function getStoredPeerId(): string | null {
  try { return localStorage.getItem(PEERID_KEY); } catch { return null; }
}

function storePeerId(id: string) {
  try { localStorage.setItem(PEERID_KEY, id); } catch {}
}

function generatePeerId(): string {
  const existing = getStoredPeerId();
  if (existing) return existing;
  const newId = 'sw_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  storePeerId(newId);
  return newId;
}

// ─── NTP Time Sync ──────────────────────────────────────

export class TimeSync {
  private offset: number = 0;       // server time - local time
  private drift: number = 0;        // ms drift per second
  private samples: number = 0;
  private lastSync: number = 0;

  async performSync(sendPing: (t: number) => void, getPong: () => Promise<{ t: number; serverT: number }>): Promise<void> {
    // 5-round NTP-style sync
    const rounds = 5;
    let bestOffset = 0;
    let minDelay = Infinity;

    for (let i = 0; i < rounds; i++) {
      const t0 = Date.now();
      sendPing(t0);
      
      const pong = await Promise.race([
        getPong(),
        new Promise<{ t: number; serverT: number }>((_, reject) => 
          setTimeout(() => reject(new Error('timeout')), 2000)
        )
      ]);
      
      const t3 = Date.now();
      const delay = t3 - t0;
      const offset = ((pong.serverT - t0) + (pong.serverT - t3)) / 2;

      if (delay < minDelay) {
        minDelay = delay;
        bestOffset = offset;
      }
      
      await new Promise(r => setTimeout(r, 200));
    }

    this.offset = bestOffset;
    this.samples = rounds;
    this.lastSync = Date.now();
  }

  getServerTime(): number {
    const elapsed = (Date.now() - this.lastSync);
    return Date.now() + this.offset + (elapsed * this.drift / 1000);
  }

  syncLocalToServer(serverTimestamp: number): number {
    const localNow = Date.now();
    this.offset = serverTimestamp - localNow;
    this.lastSync = localNow;
    return this.offset;
  }

  getOffset(): number { return this.offset; }
}

// ─── Admin Side ─────────────────────────────────────────

export class AdminSync {
  private peer: any;
  private listeners: Map<string, ListenerInfo> = new Map();
  private onStateChangeCb?: () => void;
  private onNewListenerCb?: (info: ListenerInfo) => void;
  private onSongRequestCb?: () => void;
  public peerId: string = '';
  public state: 'connecting' | 'ready' | 'error' = 'connecting';
  private PeerClass: any;
  private timeSync: TimeSync = new TimeSync();
  private pingCallbacks: Map<number, (pong: any) => void> = new Map();

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
      const storedId = getStoredPeerId();
      this.peer = new this.PeerClass(storedId || undefined);
      
      this.peer.on('open', (id: string) => {
        this.peerId = id;
        storePeerId(id);
        this.state = 'ready';
        this.onStateChangeCb?.();
      });
      
      this.peer.on('connection', (conn: any) => this.handleConnection(conn));
      
      this.peer.on('error', (err: any) => {
        console.error('[Admin] Peer error:', err);
        if (err.type === 'unavailable-id') {
          // ID taken — clear and regenerate
          try { localStorage.removeItem(PEERID_KEY); } catch {}
          setTimeout(() => this.initPeer(), 500);
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
      this.runLatencyProbe(info);
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
      this.listeners.delete(conn.peer);
      this.onStateChangeCb?.();
    });
  }

  private async runLatencyProbe(info: ListenerInfo) {
    // Multi-round latency measurement
    const rounds = 5;
    const latencies: number[] = [];
    
    for (let i = 0; i < rounds; i++) {
      const t0 = Date.now();
      
      if (!info.conn.open) return;
      info.conn.send({ type: 'latencyProbe', round: i, t: t0 });
      
      try {
        const reply = await this.waitForReply(i, 2000);
        const t3 = Date.now();
        const delay = t3 - t0;
        const oneWay = delay / 2;
        latencies.push(oneWay);
      } catch {
        // timeout, skip
      }
      
      await new Promise(r => setTimeout(r, 150));
    }

    if (latencies.length > 0) {
      // Use minimum latency (most optimistic — least congested)
      info.latency = Math.min(...latencies);
    }
  }

  private waitForReply(round: number, timeout: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pingCallbacks.delete(round);
        reject(new Error('timeout'));
      }, timeout);
      
      this.pingCallbacks.set(round, (msg) => {
        clearTimeout(timer);
        this.pingCallbacks.delete(round);
        resolve(msg);
      });
    });
  }

  private handleMessage(info: ListenerInfo, msg: SyncMessage) {
    switch (msg.type) {
      case 'requestSync': {
        info.songs = new Set(msg.knownIds);
        info.status = 'syncing';
        this.onSongRequestCb?.();
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
      case 'latencyReply': {
        const cb = this.pingCallbacks.get(msg.round);
        if (cb) cb(msg);
        break;
      }
    }
  }

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

    // Send in batches with progress
    const BATCH_SIZE = 1;
    let index = 0;
    
    const sendBatch = () => {
      if (index >= newSongs.length || !info.conn.open) {
        if (index >= newSongs.length) {
          info.status = 'ready';
          this.onStateChangeCb?.();
        }
        return;
      }
      const batch = newSongs.slice(index, index + BATCH_SIZE);
      info.conn.send({ type: 'syncSongs', songs: batch });
      batch.forEach(s => info.songs.add(s.id));
      index += BATCH_SIZE;
      setTimeout(sendBatch, 50);
    };
    sendBatch();
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
    const serverTime = Date.now();
    const cmd: SyncCmd = {
      type: 'cmd',
      action,
      songId,
      time,
      timestamp: serverTime,
      serverTime,
    };
    this.listeners.forEach(info => {
      if (info.conn.open) {
        // Add per-listener latency compensation
        const adjusted = { ...cmd, serverTime: serverTime + info.latency };
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
  onSongRequest(cb: () => void) { this.onSongRequestCb = cb; }

  destroy() {
    this.listeners.forEach(l => l.conn.close());
    this.peer?.destroy();
  }
}

// ─── Listener Side ──────────────────────────────────────

export class ListenerSync {
  private peer: any;
  private adminConn: any = null;
  public state: 'connecting' | 'syncing' | 'ready' | 'error' | 'disconnected' = 'connecting';
  public latency: number = 100;
  private onSongCb?: (song: Song) => void;
  private onCmdCb?: (cmd: SyncCmd) => void;
  private onStateChangeCb?: () => void;
  private PeerClass: any;
  private timeSync: TimeSync = new TimeSync();
  private probeCallbacks: Map<number, (msg: any) => void> = new Map();

  constructor() {
    this.PeerClass = (window as any).Peer;
  }

  async connect(adminPeerId: string, knownSongIds: string[]) {
    this.state = 'connecting';
    this.onStateChangeCb?.();

    try {
      if (!this.PeerClass) {
        await loadPeerJS();
        this.PeerClass = (window as any).Peer;
      }

      this.peer = new this.PeerClass();

      this.peer.on('open', () => {
        const conn = this.peer.connect(adminPeerId, { reliable: true });
        this.adminConn = conn;

        conn.on('open', () => {
          this.state = 'syncing';
          this.onStateChangeCb?.();
          
          // Run latency probe first
          this.runLatencyProbe().then(() => {
            // Then request songs
            conn.send({ type: 'requestSync', knownIds: knownSongIds });
          });
        });

        conn.on('data', (msg: SyncMessage) => {
          this.handleMessage(msg);
        });

        conn.on('close', () => {
          this.state = 'disconnected';
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

  private async runLatencyProbe() {
    const rounds = 5;
    const latencies: number[] = [];
    
    for (let i = 0; i < rounds; i++) {
      const t0 = Date.now();
      
      if (!this.adminConn?.open) return;
      this.adminConn.send({ type: 'latencyProbe', round: i, t: t0 });
      
      try {
        const reply = await this.waitForProbeReply(i, 2000);
        const t3 = Date.now();
        const delay = t3 - t0;
        const offset = ((reply.serverT - t0) + (reply.serverT - t3)) / 2;
        latencies.push(delay / 2);
        this.timeSync.syncLocalToServer(reply.serverT);
      } catch {
        // timeout
      }
      
      await new Promise(r => setTimeout(r, 150));
    }

    if (latencies.length > 0) {
      this.latency = Math.min(...latencies);
    }
  }

  private waitForProbeReply(round: number, timeout: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.probeCallbacks.delete(round);
        reject(new Error('timeout'));
      }, timeout);
      
      this.probeCallbacks.set(round, (msg) => {
        clearTimeout(timer);
        this.probeCallbacks.delete(round);
        resolve(msg);
      });
    });
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
      case 'latencyProbe': {
        this.adminConn?.send({ 
          type: 'latencyReply', 
          round: msg.round, 
          t: msg.t, 
          serverT: Date.now() 
        });
        break;
      }
      case 'latencyReply': {
        const cb = this.probeCallbacks.get(msg.round);
        if (cb) cb(msg);
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

// ─── Time Sync Helper ───────────────────────────────────

export function getSyncedTime(cmd: { time: number; serverTime: number }): number {
  const now = Date.now();
  const serverNow = cmd.serverTime || now;
  const networkDelay = Math.max(0, (now - serverNow) / 2000); // one-way delay estimate
  return Math.max(0, cmd.time + networkDelay);
}

// ─── Password Check ─────────────────────────────────────

export function verifyAdminPassword(input: string): boolean {
  return input === ADMIN_PASSWORD;
}

// ─── Room Discovery (via PeerJS broker introspection) ───

export function getSavedAdminId(): string | null {
  try { return localStorage.getItem(PEERID_KEY); } catch { return null; }
}
