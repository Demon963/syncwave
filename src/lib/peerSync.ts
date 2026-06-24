// SyncWave v8.0 — Cross-Network NAT Fix + Ultra-Precise Sync

const PEERJS_CDN = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:turn.anyfirewall.com:443?transport=tcp',
    username: 'webrtc',
    credential: 'webrtc',
  },
  {
    urls: 'turn:turn01.hubl.in?transport=tcp',
    username: 'hubl.in',
    credential: 'hubl.in',
  },
];

function getPeerConfig() {
  return {
    host: '0.peerjs.com',
    port: 443,
    secure: true,
    config: {
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 10,
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    },
    debug: 2,
  };
}

export const clock = { now: () => performance.now() };

function loadPeerJS(): Promise<void> {
  return new Promise((res, rej) => {
    if ((window as any).Peer) { res(); return; }
    const s = document.createElement('script');
    s.src = PEERJS_CDN;
    s.crossOrigin = 'anonymous';
    s.onload = () => res();
    s.onerror = () => rej(new Error('PeerJS load failed'));
    document.head.appendChild(s);
  });
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function filterOutliers(arr: number[]): number[] {
  if (arr.length < 4) return arr;
  const s = [...arr].sort((a, b) => a - b);
  const q1 = s[Math.floor(s.length * 0.25)];
  const q3 = s[Math.floor(s.length * 0.75)];
  const iqr = q3 - q1;
  return arr.filter(v => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function safeDestroy(p: any) { try { p?.destroy(); } catch {} }

export function computeTargetPosition(
  cmd: { time: number; ts: number },
  offset: number
): { position: number; delayMs: number } {
  const nowLocal = clock.now();
  const cmdSentAtListenerClock = cmd.ts + offset;
  const delayMs = nowLocal - cmdSentAtListenerClock;
  const position = cmd.time + delayMs / 1000;
  return { position: Math.max(0, position), delayMs };
}

interface ListenerEntry {
  conn: any;
  offset: number;
  latency: number;
}

export class AdminSync {
  peer: any;
  roomCode: string = '';
  adminPeerId: string = '';
  state: 'connecting' | 'ready' | 'error' = 'connecting';
  errorMessage: string = '';
  private L: Map<string, ListenerEntry> = new Map();
  private cbS?: () => void;
  private cbN?: (id: string) => void;
  private PC: any;
  private dead: boolean = false;
  private songs: Map<string, any> = new Map();
  private hbInterval: any = null;

  constructor(roomCode: string) {
    this.roomCode = roomCode;
    this.adminPeerId = `sw_${roomCode}`;
    this.PC = (window as any).Peer;
    if (!this.PC) {
      loadPeerJS()
        .then(() => { this.PC = (window as any).Peer; this.init(); })
        .catch(() => { this.state = 'error'; this.errorMessage = 'فشل تحميل PeerJS'; this.cbS?.(); });
    } else {
      this.init();
    }
  }

  private async init(attempt: number = 0) {
    if (this.dead) return;
    console.log('[A] Init', attempt, 'PeerID:', this.adminPeerId);
    try {
      this.peer = new this.PC(this.adminPeerId, getPeerConfig());
      await new Promise<void>((res, rej) => {
        const to = setTimeout(() => rej(new Error('timeout')), 15000);
        this.peer.on('open', () => { clearTimeout(to); res(); });
        this.peer.on('error', (e: any) => { clearTimeout(to); rej(e); });
      });
      console.log('[A] Peer open, propagating...');
      await sleep(3000);
      this.state = 'ready';
      this.errorMessage = '';
      console.log('[A] Ready:', this.adminPeerId);
      this.cbS?.();
      this.hbInterval = setInterval(() => this.heartbeat(), 5000);
      this.peer.on('connection', (c: any) => {
        console.log('[A] Conn from:', c.peer);
        c.on('open', () => this.handleListener(c));
      });
      this.peer.on('disconnected', () => { this.peer?.reconnect(); });
      this.peer.on('error', (e: any) => {
        if (e.type === 'disconnected') { this.peer?.reconnect(); return; }
        console.error('[A] Peer err:', e.type);
      });
    } catch (e: any) {
      console.error('[A] Init fail:', e?.type || e?.message);
      if (e?.type === 'unavailable-id' && attempt < 15) {
        this.errorMessage = `الرمز يتزامن (${attempt + 1}/15)...`;
        this.cbS?.();
        await sleep(4000);
        if (!this.dead) { safeDestroy(this.peer); this.init(attempt + 1); }
      } else {
        this.state = 'error';
        this.errorMessage = 'خطأ: ' + (e?.type || e?.message || 'غير معروف');
        this.cbS?.();
      }
    }
  }

  private async handleListener(c: any) {
    const entry: ListenerEntry = { conn: c, offset: 0, latency: 50 };
    this.L.set(c.peer, entry);
    try {
      const offset = await this.measureOffset(c);
      entry.offset = offset;
      entry.latency = Math.abs(offset);
      console.log(`[A] Listener ${c.peer.slice(0, 6)} offset=${offset.toFixed(1)}ms`);
    } catch (err) {
      console.error('[A] Clock sync failed:', err);
    }
    c.on('data', (msg: any) => {
      if (msg.t === 'ping_l') {
        c.send({ t: 'pong_l', id: msg.id, t0: msg.t0, t1: clock.now() });
      } else if (msg.t === 'requestSync') {
        this.sndAll(c);
      }
    });
    c.on('close', () => {
      console.log('[A] Listener closed:', c.peer.slice(0, 6));
      this.L.delete(c.peer);
      this.cbS?.();
    });
    c.on('error', (err: any) => {
      console.error('[A] Listener err:', c.peer.slice(0, 6), err);
      this.L.delete(c.peer);
      this.cbS?.();
    });
    this.sndAll(c);
    this.cbN?.(c.peer);
    this.cbS?.();
  }

  private async measureOffset(conn: any): Promise<number> {
    const offsets: number[] = [];
    for (let i = 0; i < 15; i++) {
      if (!conn.open) break;
      const t0 = clock.now();
      const pong = await new Promise<{ t0: number; t1: number } | null>((resolve) => {
        conn.send({ t: 'ping', id: i, t0 });
        const handler = (msg: any) => {
          if (msg.t === 'pong' && msg.id === i) {
            conn.off('data', handler);
            resolve({ t0: msg.t0, t1: msg.t1 });
          }
        };
        conn.on('data', handler);
        setTimeout(() => { conn.off('data', handler); resolve(null); }, 500);
      });
      if (pong) {
        const t3 = clock.now();
        const rtt = t3 - t0;
        if (rtt < 500) {
          const estOffset = pong.t1 - t0 - rtt / 2;
          offsets.push(estOffset);
        }
      }
      await sleep(20);
    }
    if (!offsets.length) return 0;
    const filtered = filterOutliers(offsets);
    return filtered.length ? median(filtered) : median(offsets);
  }

  private heartbeat() {
    this.L.forEach((e, id) => {
      if (!e.conn.open) { this.L.delete(id); this.cbS?.(); return; }
      try { e.conn.send({ t: 'hb' }); } catch {}
    });
  }

  private async sndAll(c: any) {
    const songs = Array.from(this.songs.values());
    if (!songs.length) { if (c.open) c.send({ t: 'sd' }); return; }
    for (const s of songs) { if (!c.open) break; await this.sndSong(c, s); }
    if (c.open) c.send({ t: 'sd' });
  }

  private async sndSong(c: any, song: any) {
    const SZ = 16000;
    const chunks: string[] = [];
    for (let i = 0; i < song.fileData.length; i += SZ) chunks.push(song.fileData.slice(i, i + SZ));
    c.send({ t: 'sm', meta: { id: song.id, title: song.title, mimeType: song.mimeType, duration: song.duration, size: song.size, tc: chunks.length } });
    await sleep(30);
    for (let i = 0; i < chunks.length; i++) {
      if (!c.open) return;
      c.send({ t: 'sc', sid: song.id, idx: i, d: chunks[i] });
      if (i % 50 === 0) await sleep(10);
    }
    await sleep(20);
    if (c.open) c.send({ t: 'sdone', sid: song.id });
  }

  addSong(song: any) {
    console.log('[A] addSong:', song.title);
    this.songs.set(song.id, song);
    this.L.forEach((e) => { if (e.conn.open) this.sndSong(e.conn, song); });
  }

  sendCommand(action: string, songId: string, time: number) {
    const ts = clock.now();
    this.L.forEach((e) => {
      if (e.conn.open) {
        e.conn.send({ t: 'cmd', action, songId, time, ts, off: e.offset });
      }
    });
  }

  getListenerCount(): number {
    let c = 0;
    this.L.forEach((e) => { if (e.conn?.open) c++; });
    return c;
  }

  onStateChange(cb: () => void) { this.cbS = cb; }
  onNewListener(cb: (id: string) => void) { this.cbN = cb; }

  destroy() {
    this.dead = true;
    if (this.hbInterval) clearInterval(this.hbInterval);
    this.L.forEach((e) => { try { e.conn?.close(); } catch {} });
    safeDestroy(this.peer);
  }
}

export class ListenerSync {
  private peer: any;
  private conn: any = null;
  state: 'connecting' | 'syncing' | 'ready' | 'error' | 'disconnected' = 'connecting';
  errorMessage: string = '';
  private cbSong?: (song: any) => void;
  private cbCmd?: (cmd: any) => void;
  private cbState?: () => void;
  private PC: any;
  private dead: boolean = false;
  private rx: Map<string, any> = new Map();
  private syncTimer: any = null;
  private connOpen: boolean = false;
  private hbTimer: any = null;
  private offset: number = 0;

  constructor() { this.PC = (window as any).Peer; }

  async connect(roomCode: string, knownSongIds: string[]) {
    this.errorMessage = '';
    this.state = 'connecting';
    this.dead = false;
    this.connOpen = false;
    this.offset = 0;
    this.rx.clear();
    if (this.syncTimer) clearTimeout(this.syncTimer);
    if (this.hbTimer) clearInterval(this.hbTimer);
    try {
      if (!this.PC) {
        await loadPeerJS();
        this.PC = (window as any).Peer;
      }
      this.init(roomCode, knownSongIds);
    } catch (e) {
      this.state = 'error';
      this.errorMessage = 'فشل تحميل PeerJS';
      this.cbState?.();
    }
  }

  private async init(roomCode: string, kids: string[], att: number = 0) {
    if (this.dead) return;
    const adminPeerId = `sw_${roomCode}`;
    console.log('[L] Init peer, attempt', att + 1);
    try {
      this.peer = new this.PC(undefined, getPeerConfig());
      await new Promise<void>((res, rej) => {
        const to = setTimeout(() => rej(new Error('timeout')), 15000);
        this.peer.on('open', () => { clearTimeout(to); res(); });
        this.peer.on('error', (e: any) => { if (e.type !== 'disconnected') { clearTimeout(to); rej(e); } });
      });
      console.log('[L] Peer open:', this.peer.id);
      await sleep(2000);
      this.dc(adminPeerId, kids, 0);
      this.peer.on('disconnected', () => { this.peer?.reconnect(); });
      this.peer.on('error', (e: any) => {
        if (e.type === 'disconnected') { this.peer?.reconnect(); return; }
        console.error('[L] Peer err:', e.type);
      });
    } catch (e: any) {
      console.error('[L] Peer init err:', e?.type || e?.message);
      if (att < 3) {
        safeDestroy(this.peer);
        await sleep(3000);
        if (!this.dead) this.init(roomCode, kids, att + 1);
      } else {
        this.state = 'error';
        this.errorMessage = 'تعذر إنشاء الاتصال.';
        this.cbState?.();
      }
    }
  }

  private dc(aid: string, kids: string[], att: number) {
    if (this.dead) return;
    console.log('[L] Connect to', aid, 'attempt', att + 1);
    try {
      this.conn = this.peer.connect(aid, { reliable: true });
    } catch (e) {
      this.retryOrFail(aid, kids, att);
      return;
    }
    let opened = false;
    const to = setTimeout(() => {
      if (opened || this.dead) return;
      try { this.conn.close(); } catch {}
      this.retryOrFail(aid, kids, att);
    }, 15000);
    this.conn.on('open', () => {
      opened = true;
      clearTimeout(to);
      console.log('[L] Connected!');
      this.connOpen = true;
      this.state = 'syncing';
      this.cbState?.();
      this.hbTimer = setInterval(() => this.checkAlive(), 10000);
      try { this.conn.send({ t: 'requestSync', kids }); } catch (e) {}
      this.syncTimer = setTimeout(() => {
        if (this.state === 'syncing' && !this.dead) {
          this.state = 'ready';
          this.cbState?.();
        }
      }, 8000);
    });
    this.conn.on('data', (msg: any) => {
      if (msg.t === 'hb') {
        try { this.conn.send({ t: 'hb_ack' }); } catch {}
        return;
      }
      if (msg.t === 'ping') {
        this.conn.send({ t: 'pong', id: msg.id, t0: msg.t0, t1: clock.now() });
        return;
      }
      this.onData(msg);
    });
    this.conn.on('close', () => {
      clearTimeout(to);
      if (this.syncTimer) clearTimeout(this.syncTimer);
      if (this.hbTimer) clearInterval(this.hbTimer);
      console.log('[L] Conn closed');
      if (!this.dead && this.state !== 'error') {
        this.connOpen = false;
        this.state = 'disconnected';
        this.cbState?.();
      }
    });
    this.conn.on('error', (e: any) => {
      clearTimeout(to);
      console.error('[L] Conn error:', e);
      if (!opened) this.retryOrFail(aid, kids, att);
    });
  }

  private checkAlive() {
    if (!this.conn?.open && this.connOpen) {
      console.log('[L] Connection lost');
      this.connOpen = false;
      this.state = 'disconnected';
      this.cbState?.();
    }
  }

  private retryOrFail(aid: string, kids: string[], att: number) {
    if (att < 10) {
      const delay = Math.min(2000 + att * 500, 6000);
      console.log(`[L] Retry ${att + 2}/11 in ${delay}ms`);
      setTimeout(() => { if (!this.dead) this.dc(aid, kids, att + 1); }, delay);
    } else {
      safeDestroy(this.peer);
      this.state = 'error';
      this.errorMessage = 'تعذر الاتصال بالمسؤول. تأكد من الرمز.';
      this.cbState?.();
    }
  }

  private onData(msg: any) {
    switch (msg.t) {
      case 'sm': {
        this.rx.set(msg.meta.id, { m: msg.meta, c: new Array(msg.meta.tc).fill(''), r: 0 });
        break;
      }
      case 'sc': {
        const r = this.rx.get(msg.sid);
        if (r && msg.idx < r.c.length) { r.c[msg.idx] = msg.d; r.r++; }
        break;
      }
      case 'sdone': {
        const r = this.rx.get(msg.sid);
        if (!r) return;
        const missing = r.c.map((c: string, i: number) => c === '' ? i : -1).filter((i: number) => i >= 0);
        if (missing.length) { this.rx.delete(msg.sid); break; }
        const song = { ...r.m, fileData: r.c.join(''), createdAt: Date.now() };
        this.rx.delete(msg.sid);
        this.cbSong?.(song);
        if (this.state === 'syncing') { this.state = 'ready'; this.cbState?.(); }
        break;
      }
      case 'sd': {
        if (this.syncTimer) clearTimeout(this.syncTimer);
        if (this.state === 'syncing' && !this.dead) {
          this.state = 'ready';
          this.cbState?.();
        }
        break;
      }
      case 'cmd': {
        if (msg.off !== undefined) this.offset = msg.off;
        this.cbCmd?.({ ...msg, _listenerOffset: this.offset });
        break;
      }
      default:
        break;
    }
  }

  onSong(cb: (song: any) => void) { this.cbSong = cb; }
  onCmd(cb: (cmd: any) => void) { this.cbCmd = cb; }
  onStateChange(cb: () => void) { this.cbState = cb; }

  disconnect() {
    this.dead = true;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    if (this.hbTimer) clearInterval(this.hbTimer);
    try { this.conn?.close(); } catch {}
    safeDestroy(this.peer);
    this.state = 'disconnected';
  }
}
