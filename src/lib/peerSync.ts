const PEERJS_CDN = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
];

function getCfg() { return { config: { iceServers: ICE_SERVERS, iceCandidatePoolSize: 10 }, debug: 0 }; }
export function now() { return performance.now(); }

function loadP(): Promise<void> {
  return new Promise((res, rej) => {
    if ((window as any).Peer) { res(); return; }
    const s = document.createElement('script'); s.src = PEERJS_CDN; s.crossOrigin = 'anonymous';
    s.onload = () => res(); s.onerror = () => rej(new Error('PeerJS load failed'));
    document.head.appendChild(s);
  });
}
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
export function getSyncedTime(cmd: { time: number; ts: number }, clockOffset: number = 0) {
  return cmd.time + (now() - (cmd.ts - clockOffset)) / 1000;
}
const med = (arr: number[]) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
function sd(p: any) { try { p?.destroy(); } catch {} }

// ─── ADMIN ──────────────────────────────────────────────

export class AdminSync {
  peer: any;
  adminPeerId: string = '';
  state: 'connecting' | 'ready' | 'error' = 'connecting';
  private L: Map<string, any> = new Map();
  private cbS?: () => void;
  private cbN?: (id: string) => void;
  private PC: any;
  private dead: boolean = false;
  private songs: Map<string, any> = new Map();

  constructor() {
    this.PC = (window as any).Peer;
    if (!this.PC) loadP().then(() => { this.PC = (window as any).Peer; this.init(); }).catch(() => { this.state = 'error'; this.cbS?.(); });
    else this.init();
  }

  private init() {
    if (this.dead) return;
    try {
      this.peer = new this.PC(undefined, getCfg());
      this.peer.on('open', (id: string) => { this.adminPeerId = id; this.state = 'ready'; console.log('[A] Ready:', id); this.cbS?.(); });
      this.peer.on('connection', (c: any) => { console.log('[A] Conn from:', c.peer); c.on('open', () => this.hConn(c)); });
      this.peer.on('error', (e: any) => { console.error('[A] err:', e.type); this.state = 'error'; this.cbS?.(); });
      this.peer.on('disconnected', () => { this.peer?.reconnect(); });
    } catch (e) { this.state = 'error'; this.cbS?.(); }
  }

  private async hConn(c: any) {
    const e = { conn: c, off: 0 };
    this.L.set(c.peer, e);
    try { const r = await this.calib(c); e.off = r; console.log('[A] Clock:', r); } catch {}
    c.on('close', () => { this.L.delete(c.peer); this.cbS?.(); });
    c.on('error', () => { this.L.delete(c.peer); this.cbS?.(); });
    c.on('data', (msg: any) => { if (msg.type === 'requestSync') this.sndAll(c); });
    console.log('[A] Sending', this.songs.size, 'songs');
    this.sndAll(c);
    this.cbN?.(c.peer); this.cbS?.();
  }

  private async sndAll(c: any) {
    const songs = Array.from(this.songs.values());
    if (!songs.length) { if (c.open) c.send({ t: 'sd' }); return; }
    for (const s of songs) { if (!c.open) break; await this.sndSong(c, s); }
    if (c.open) c.send({ t: 'sd' });
  }

  private async sndSong(c: any, song: any) {
    const sz = 16000;
    const chunks: string[] = [];
    for (let i = 0; i < song.fileData.length; i += sz) chunks.push(song.fileData.slice(i, i + sz));
    c.send({ t: 'sm', meta: { id: song.id, title: song.title, mimeType: song.mimeType, duration: song.duration, size: song.size, tc: chunks.length } });
    await sleep(20);
    for (let i = 0; i < chunks.length; i++) { if (!c.open) return; c.send({ t: 'sc', sid: song.id, idx: i, d: chunks[i] }); }
    await sleep(20);
    if (c.open) c.send({ t: 'sdone', sid: song.id });
  }

  addSong(song: any) {
    console.log('[A] addSong:', song.title);
    this.songs.set(song.id, song);
    this.L.forEach((e: any) => { if (e.conn.open) this.sndSong(e.conn, song); });
  }

  sendCmd(action: string, songId: string, time: number) {
    const ts = now();
    this.L.forEach((e: any) => { if (e.conn.open) e.conn.send({ t: 'cmd', action, songId, time, ts, offset: e.off }); });
  }
  getLC(): number { let c = 0; this.L.forEach((e: any) => { if (e.conn?.open) c++; }); return c; }
  onStateChange(cb: () => void) { this.cbS = cb; }
  onNewListener(cb: (id: string) => void) { this.cbN = cb; }
  destroy() { this.dead = true; this.L.forEach((e: any) => e.conn?.close()); sd(this.peer); }

  private async calib(c: any) {
    const o: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = now(); c.send({ t: 'cs', tm: t0 });
      const r = await new Promise<number>((res) => {
        const h = (msg: any) => { if (msg.t === 'csr' && Math.abs(msg.tm - t0) < 1) { c.off('data', h); res(now()); } };
        c.on('data', h); setTimeout(() => { c.off('data', h); res(t0); }, 800);
      });
      if (r > t0) { const rtt = r - t0; o.push(t0 + rtt / 2 - ((await new Promise((res) => setTimeout(() => res(0), 0))) || 0)); }
      const rp = await new Promise<{ t2: number; l1: number }>((res) => {
        const h2 = (msg: any) => { if (msg.t === 'csr' && Math.abs(msg.tm - t0) < 1) { c.off('data', h2); res({ t2: r || now(), l1: msg.l1 }); } };
        c.on('data', h2); setTimeout(() => { c.off('data', h2); res({ t2: t0, l1: 0 }); }, 800);
      });
      if (rp.t2 > t0 && rp.l1 > 0) o.push(t0 + (rp.t2 - t0) / 2 - rp.l1);
      await sleep(60);
    }
    return o.length ? med(o) : 0;
  }
}

// ─── LISTENER ───────────────────────────────────────────

export class ListenerSync {
  private peer: any;
  private conn: any = null;
  state: 'connecting' | 'syncing' | 'ready' | 'error' | 'disconnected' = 'connecting';
  private cbSong?: (song: any) => void;
  private cbCmd?: (cmd: any) => void;
  private cbState?: () => void;
  private PC: any;
  private dead: boolean = false;
  private rx: Map<string, any> = new Map();
  private timer: any = null;

  constructor() { this.PC = (window as any).Peer; }

  async connect(adminPeerId: string, knownSongIds: string[]) {
    console.log('[L] connect to:', adminPeerId);
    this.state = 'connecting'; this.dead = false; this.rx.clear();
    if (this.timer) clearTimeout(this.timer);
    try { if (!this.PC) { await loadP(); this.PC = (window as any).Peer; } this.init(adminPeerId, knownSongIds); }
    catch (e) { console.error('[L] Connect fail:', e); this.state = 'error'; this.cbState?.(); }
  }

  private init(aid: string, kids: string[], att: number = 0) {
    if (this.dead) return;
    try {
      this.peer = new this.PC(undefined, getCfg());
      this.peer.on('open', () => { console.log('[L] Peer open:', this.peer.id); this.dc(aid, kids, att); });
      this.peer.on('error', (e: any) => { console.error('[L] Peer err:', e.type); if (att < 3) setTimeout(() => { if (!this.dead) { sd(this.peer); this.init(aid, kids, att + 1); } }, 3000); else { this.state = 'error'; this.cbState?.(); } });
      this.peer.on('disconnected', () => { this.peer?.reconnect(); });
    } catch { this.state = 'error'; this.cbState?.(); }
  }

  private dc(aid: string, kids: string[], att: number) {
    if (this.dead) return;
    console.log('[L] peer.connect to', aid);
    this.conn = this.peer.connect(aid, { reliable: true, serialization: 'json' });
    const to = setTimeout(() => { if (this.conn.open || this.dead) return; console.log('[L] Timeout'); this.conn.close(); if (att < 3) setTimeout(() => this.dc(aid, kids, att + 1), 3000); else { this.state = 'error'; this.cbState?.(); } }, 15000);
    this.conn.on('open', () => { clearTimeout(to); console.log('[L] ✅ CONNECTED!'); this.state = 'syncing'; this.cbState?.(); this.conn.send({ t: 'requestSync', kids }); this.timer = setTimeout(() => { if (this.state === 'syncing' && !this.dead) { console.log('[L] Force ready'); this.state = 'ready'; this.cbState?.(); } }, 10000); });
    this.conn.on('data', (msg: any) => this.onD(msg));
    this.conn.on('close', () => { clearTimeout(to); if (this.timer) clearTimeout(this.timer); if (!this.dead) { this.state = 'disconnected'; this.cbState?.(); } });
    this.conn.on('error', (e: any) => { clearTimeout(to); console.error('[L] Conn err:', e); });
  }

  private onD(msg: any) {
    switch (msg.t) {
      case 'sm': { console.log('[L] Meta:', msg.meta.title); this.rx.set(msg.meta.id, { m: msg.meta, c: new Array(msg.meta.tc).fill(''), r: 0 }); break; }
      case 'sc': { const r = this.rx.get(msg.sid); if (r && msg.idx < r.c.length) { r.c[msg.idx] = msg.d; r.r++; } break; }
      case 'sdone': { const r = this.rx.get(msg.sid); if (!r) return; const bad = r.c.map((c: string, i: number) => c === '' ? i : -1).filter((i: number) => i >= 0); if (bad.length) { console.warn('[L] Missing chunks'); this.rx.delete(msg.sid); break; } const song = { ...r.m, fileData: r.c.join(''), createdAt: Date.now() }; this.rx.delete(msg.sid); console.log('[L] ✅ Song:', song.title); this.cbSong?.(song); if (this.state === 'syncing') { this.state = 'ready'; this.cbState?.(); } break; }
      case 'sd': { console.log('[L] ✅ syncDone!'); if (this.timer) clearTimeout(this.timer); if (this.state === 'syncing' && !this.dead) { this.state = 'ready'; this.cbState?.(); } break; }
      case 'cmd': { this.cbCmd?.({ ...msg, _listenerOffset: msg.offset || 0 }); break; }
      case 'cs': { this.conn?.send({ t: 'csr', tm: msg.tm, l1: now() }); break; }
      default: console.log('[L] Unknown:', msg.t);
    }
  }

  onSong(cb: (song: any) => void) { this.cbSong = cb; }
  onCmd(cb: (cmd: any) => void) { this.cbCmd = cb; }
  onStateChange(cb: () => void) { this.cbState = cb; }
  disconnect() { this.dead = true; if (this.timer) clearTimeout(this.timer); this.conn?.close(); sd(this.peer); this.state = 'disconnected'; }
}
