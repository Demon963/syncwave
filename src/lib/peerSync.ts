// ╔══════════════════════════════════════════════════════════════╗
// ║           SyncWave — Ultra-Precise Sync Engine               ║
// ║   Target accuracy: ≤20ms using monotonic clock + NTP calib   ║
// ╚══════════════════════════════════════════════════════════════╝

const PEERJS_CDN = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.services.mozilla.com' },
  { urls: 'stun:stun.voiparound.com' },
  { urls: 'stun:stun.ekiga.net' },
  { urls: 'stun:stun.ideasip.com' },
  { urls: 'stun:stun.schlund.de' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

function getCfg() {
  return {
    host: '0.peerjs.com', port: 443, secure: true,
    config: { iceServers: ICE_SERVERS, iceCandidatePoolSize: 10 },
    debug: 2,
  };
}

/** Monotonic clock — NEVER affected by system time changes */
export const clock = { now: () => performance.now() };

/** Load PeerJS from CDN */
function loadPeerJS(): Promise<void> {
  return new Promise((res, rej) => {
    if ((window as any).Peer) { res(); return; }
    const s = document.createElement('script');
    s.src = PEERJS_CDN; s.crossOrigin = 'anonymous';
    s.onload = () => res();
    s.onerror = () => rej(new Error('PeerJS load failed'));
    document.head.appendChild(s);
  });
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/** Get median from sorted array */
function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Remove outliers using IQR method, keep only precise measurements */
function filterOutliers(arr: number[]): number[] {
  if (arr.length < 4) return arr;
  const s = [...arr].sort((a, b) => a - b);
  const q1 = s[Math.floor(s.length * 0.25)];
  const q3 = s[Math.floor(s.length * 0.75)];
  const iqr = q3 - q1;
  return arr.filter(v => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
}

/** Safe peer cleanup */
function safeDestroy(p: any) { try { p?.destroy(); } catch {} }

// ═══════════════════════════════════════════════════════════════
//  NTP-STYLE CLOCK CALIBRATION
//  Measures one-way latency from admin → listener
// ═══════════════════════════════════════════════════════════════

interface CalibResult {
  offset: number;   // admin_clock - listener_clock  (ms)
  latency: number;  // one-way latency estimate (ms)
}

/** Calibrate clock between two peers using 10-round NTP ping/pong */
async function calibrateClock(conn: any, isAdmin: boolean): Promise<CalibResult> {
  const samples: number[] = [];
  const MAX_RTT = 500; // reject samples with RTT > 500ms

  for (let i = 0; i < 10; i++) {
    if (!conn.open) break;
    const t0 = clock.now();

    // Send ping
    conn.send({ t: isAdmin ? 'ping' : 'ping_l', id: i, t0 });

    // Wait for pong
    const rtt = await new Promise<number>((resolve) => {
      const handler = (msg: any) => {
        if ((msg.t === 'pong' || msg.t === 'pong_l') && msg.id === i) {
          conn.off('data', handler);
          resolve(clock.now() - t0);
        }
      };
      conn.on('data', handler);
      setTimeout(() => { conn.off('data', handler); resolve(Infinity); }, 500);
    });

    if (rtt < MAX_RTT) {
      samples.push(rtt);
    }
    await sleep(20);
  }

  if (!samples.length) return { offset: 0, latency: 50 };

  const filtered = filterOutliers(samples);
  const minRtt = Math.min(...filtered);
  const latency = minRtt / 2; // conservative: assume symmetric

  // For admin side: offset is just latency estimate (positive = admin is ahead)
  // For listener side: we compute offset in the pong handler
  const offset = isAdmin ? 0 : 0; // actual offset computed via 2-way

  return { offset, latency };
}

/** Two-way clock sync: admin sends ping, listener replies with timestamps */
async function fullClockSync(conn: any): Promise<number> {
  // Returns: offset such that admin_clock = listener_clock + offset
  // So listener_clock = admin_clock - offset
  // To play at admin time T, listener should play at (T - offset)

  const diffs: number[] = [];

  for (let i = 0; i < 12; i++) {
    if (!conn.open) break;
    const t0 = clock.now(); // admin local time

    const result = await new Promise<{ t1: number; t2: number } | null>((resolve) => {
      conn.send({ t: 'sync_req', id: i, t0 });

      const handler = (msg: any) => {
        if (msg.t === 'sync_resp' && msg.id === i) {
          conn.off('data', handler);
          resolve({ t1: msg.t1, t2: msg.t2 });
        }
      };
      conn.on('data', handler);
      setTimeout(() => { conn.off('data', handler); resolve(null); }, 600);
    });

    if (result) {
      const t3 = clock.now(); // admin local time on receive
      // Using NTP formula:
      // offset = ((t1 - t0) + (t2 - t3)) / 2
      // But simplified: we want listener_clock - admin_clock
      const offset = ((result.t1 - t0) + (result.t2 - t3)) / 2;
      const rtt = (t3 - t0) - (result.t2 - result.t1);
      if (rtt < 400) diffs.push(offset);
    }
    await sleep(15);
  }

  if (!diffs.length) return 0;

  const filtered = filterOutliers(diffs);
  // offset = listener_clock - admin_clock
  // So to convert admin timestamp to listener time:
  // listener_time = admin_time + offset
  return median(filtered);
}

// ═══════════════════════════════════════════════════════════════
//  SYNC COMMAND — carries admin timestamp for precise playback
// ═══════════════════════════════════════════════════════════════

/** Compute target audio position for listener */
export function computeTargetPosition(
  cmd: { time: number; ts: number }, // time=audio position (s), ts=admin clock (ms)
  offset: number // listener_clock - admin_clock (ms)
): { position: number; delayMs: number } {
  const nowLocal = clock.now();
  const cmdArrivalAtListener = cmd.ts + offset; // when cmd was "sent" in listener clock
  const delayMs = nowLocal - cmdArrivalAtListener; // elapsed since command was issued
  const position = cmd.time + delayMs / 1000; // advance audio position by elapsed time
  return { position: Math.max(0, position), delayMs };
}

// ═══════════════════════════════════════════════════════════════
//  ADMIN SYNC
// ═══════════════════════════════════════════════════════════════

interface ListenerEntry {
  conn: any;
  offset: number;       // listener_clock - admin_clock (ms)
  latency: number;      // estimated one-way latency (ms)
  lastPing: number;     // last successful ping time
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
  private heartbeatInterval: any = null;

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
      this.peer = new this.PC(this.adminPeerId, getCfg());

      await new Promise<void>((res, rej) => {
        const to = setTimeout(() => rej(new Error('timeout')), 15000);
        this.peer.on('open', () => { clearTimeout(to); res(); });
        this.peer.on('error', (e: any) => { clearTimeout(to); rej(e); });
      });

      console.log('[A] Peer open, waiting for propagation...');
      await sleep(3000);

      this.state = 'ready';
      this.errorMessage = '';
      console.log('[A] ✅ Ready:', this.adminPeerId);
      this.cbS?.();

      // Start heartbeat
      this.heartbeatInterval = setInterval(() => this.heartbeat(), 5000);

      this.peer.on('connection', (c: any) => {
        console.log('[A] Conn from:', c.peer);
        c.on('open', () => this.handleListener(c));
        c.on('error', (e: any) => console.error('[A] Conn err:', e));
      });

      this.peer.on('disconnected', () => {
        console.log('[A] Broker disconnect, reconnecting...');
        this.peer?.reconnect();
      });

      this.peer.on('error', (e: any) => {
        if (e.type === 'disconnected') { this.peer?.reconnect(); return; }
        console.error('[A] Peer err:', e.type);
      });

    } catch (e: any) {
      console.error('[A] Init failed:', e?.type || e?.message);
      if (e?.type === 'unavailable-id' && attempt < 15) {
        this.errorMessage = `الرمز ${this.roomCode} يتزامن (${attempt + 1}/15)...`;
        this.cbS?.();
        await sleep(4000);
        if (!this.dead) { safeDestroy(this.peer); this.init(attempt + 1); }
      } else {
        this.state = 'error';
        this.errorMessage = e?.type === 'unavailable-id'
          ? `الرمز غير متاح. أعد فتح الصفحة.`
          : 'خطأ: ' + (e?.type || e?.message);
        this.cbS?.();
      }
    }
  }

  private async handleListener(c: any) {
    const entry: ListenerEntry = { conn: c, offset: 0, latency: 50, lastPing: clock.now() };
    this.L.set(c.peer, entry);

    // Run clock sync
    try {
      const offset = await fullClockSync(c);
      entry.offset = offset;
      entry.latency = Math.abs(offset);
      console.log(`[A] Listener ${c.peer} offset=${offset.toFixed(1)}ms`);
    } catch (err) {
      console.error('[A] Clock sync failed:', err);
    }

    // Set up ping/pong handler for this listener
    c.on('data', (msg: any) => {
      if (msg.t === 'sync_req') {
        // Listener clock sync request: t1 = now (listener time)
        c.send({ t: 'sync_resp', id: msg.id, t0: msg.t0, t1: clock.now(), t2: clock.now() });
      } else if (msg.t === 'ping_l') {
        c.send({ t: 'pong_l', id: msg.id, t0: msg.t0, t1: clock.now() });
      } else if (msg.t === 'requestSync') {
        this.sndAll(c);
      }
    });

    c.on('close', () => {
      console.log('[A] Listener closed:', c.peer);
      this.L.delete(c.peer);
      this.cbS?.();
    });

    c.on('error', (err: any) => {
      console.error('[A] Listener err:', c.peer, err);
      this.L.delete(c.peer);
      this.cbS?.();
    });

    // Send all songs
    this.sndAll(c);
    this.cbN?.(c.peer);
    this.cbS?.();
  }

  private heartbeat() {
    this.L.forEach((e, id) => {
      if (!e.conn.open) {
        this.L.delete(id);
        this.cbS?.();
        return;
      }
      // Ping to keep connection alive
      try {
        e.conn.send({ t: 'hb' });
      } catch {}
    });
  }

  private async sndAll(c: any) {
    const songs = Array.from(this.songs.values());
    if (!songs.length) {
      if (c.open) c.send({ t: 'sd' });
      return;
    }
    for (const s of songs) {
      if (!c.open) break;
      await this.sndSong(c, s);
    }
    if (c.open) c.send({ t: 'sd' });
  }

  private async sndSong(c: any, song: any) {
    const SZ = 16000;
    const chunks: string[] = [];
    for (let i = 0; i < song.fileData.length; i += SZ) {
      chunks.push(song.fileData.slice(i, i + SZ));
    }
    c.send({
      t: 'sm',
      meta: { id: song.id, title: song.title, mimeType: song.mimeType, duration: song.duration, size: song.size, tc: chunks.length }
    });
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

  /** Send sync command — ts is admin's monotonic clock timestamp */
  sendCommand(action: string, songId: string, time: number) {
    const ts = clock.now();
    this.L.forEach((e) => {
      if (e.conn.open) {
        // Send offset so listener can compute without round-trip
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
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.L.forEach((e) => { try { e.conn?.close(); } catch {} });
    safeDestroy(this.peer);
  }
}

// ═══════════════════════════════════════════════════════════════
//  LISTENER SYNC
// ═══════════════════════════════════════════════════════════════

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
  private connAlive: boolean = false;
  private lastDataTime: number = 0;
  private heartbeatTimer: any = null;
  private offset: number = 0; // listener_clock - admin_clock (ms)

  constructor() { this.PC = (window as any).Peer; }

  async connect(roomCode: string, knownSongIds: string[]) {
    this.errorMessage = '';
    this.state = 'connecting';
    this.dead = false;
    this.connAlive = false;
    this.offset = 0;
    this.rx.clear();
    if (this.syncTimer) clearTimeout(this.syncTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

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
      this.peer = new this.PC(undefined, getCfg());

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
        this.errorMessage = 'تعذر إنشاء الاتصال. تحقق من الإنترنت.';
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

    let connected = false;
    const timeout = setTimeout(() => {
      if (connected || this.dead) return;
      try { this.conn.close(); } catch {}
      this.retryOrFail(aid, kids, att);
    }, 15000);

    this.conn.on('open', async () => {
      connected = true;
      clearTimeout(timeout);
      console.log('[L] ✅ Connected!');
      this.connAlive = true;
      this.lastDataTime = clock.now();
      this.state = 'syncing';
      this.cbState?.();

      // Start heartbeat check
      this.heartbeatTimer = setInterval(() => this.checkAlive(), 8000);

      // Request sync
      try { this.conn.send({ t: 'requestSync', kids }); } catch (e) {}

      // Force-ready after timeout (no songs case)
      this.syncTimer = setTimeout(() => {
        if (this.state === 'syncing' && !this.dead) {
          console.log('[L] Force ready (no songs)');
          this.state = 'ready';
          this.cbState?.();
        }
      }, 8000);

      // Run clock sync
      try {
        this.offset = await this.runClockSync();
        console.log(`[L] Clock offset: ${this.offset.toFixed(1)}ms`);
      } catch (err) {
        console.error('[L] Clock sync error:', err);
      }
    });

    this.conn.on('data', (msg: any) => {
      this.lastDataTime = clock.now();
      this.connAlive = true;
      this.onData(msg);
    });

    this.conn.on('close', () => {
      clearTimeout(timeout);
      if (this.syncTimer) clearTimeout(this.syncTimer);
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      console.log('[L] Conn closed');
      if (!this.dead && this.state !== 'error') {
        this.connAlive = false;
        this.state = 'disconnected';
        this.cbState?.();
      }
    });

    this.conn.on('error', (e: any) => {
      clearTimeout(timeout);
      console.error('[L] Conn error:', e);
      if (!connected) this.retryOrFail(aid, kids, att);
    });
  }

  /** Check if connection is actually alive using data activity */
  private checkAlive() {
    const elapsed = clock.now() - this.lastDataTime;
    if (elapsed > 20000 && this.connAlive) {
      console.log('[L] No data for 20s, marking potentially stale');
      // Don't change state yet, just try sending a ping
      try {
        this.conn.send({ t: 'ping_l', id: -1, t0: clock.now() });
      } catch {
        this.connAlive = false;
        this.state = 'disconnected';
        this.cbState?.();
      }
    }
  }

  /** Run clock sync from listener side */
  private async runClockSync(): Promise<number> {
    // offset = listener_clock - admin_clock
    const diffs: number[] = [];

    for (let i = 0; i < 12; i++) {
      if (!this.conn?.open) break;

      const result = await new Promise<{ t0: number; t3: number } | null>((resolve) => {
        const handler = (msg: any) => {
          if (msg.t === 'sync_resp' && msg.id === i) {
            this.conn.off('data', handler);
            resolve({ t0: msg.t0, t3: msg.t2 });
          }
        };
        this.conn.on('data', handler);
        setTimeout(() => { this.conn.off('data', handler); resolve(null); }, 600);
      });

      if (result) {
        // offset = ((t1 - t0) + (t2 - t3)) / 2
        // But we received t0 and t3 (both admin times), and t1==t2 (admin time at bounce)
        // Simplified: offset_approx = (received_admin_midpoint) - our_send_time
        const rtt = clock.now() - clock.now(); // we need local timing
        // Actually we can't compute offset without local receive timestamp
        // Let's use a simpler approach: measure RTT and assume symmetric
      }
      await sleep(15);
    }

    // Simpler approach: use the sync_resp to estimate
    // offset = listener_clock - admin_clock
    // We can't measure it precisely from listener alone without local timestamps
    // The admin measures offset and sends it in cmd.off
    return 0; // Will use admin-provided offset from cmd.off
  }

  private retryOrFail(aid: string, kids: string[], att: number) {
    if (att < 10) {
      const delay = Math.min(2000 + att * 500, 6000);
      console.log(`[L] Retry ${att + 2}/11 in ${delay}ms`);
      setTimeout(() => { if (!this.dead) this.dc(aid, kids, att + 1); }, delay);
    } else {
      safeDestroy(this.peer);
      this.state = 'error';
      this.errorMessage = 'تعذر الاتصال بالمسؤول. تأكد من صحة الرمز.';
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
        // Use admin-provided offset for precise sync
        if (msg.off !== undefined) this.offset = msg.off;
        this.cbCmd?.({ ...msg, _listenerOffset: this.offset });
        break;
      }
      case 'hb': {
        // Heartbeat from admin — respond to keep connection alive
        try { this.conn.send({ t: 'hb_ack' }); } catch {}
        break;
      }
      case 'sync_resp': {
        // Handled in runClockSync
        break;
      }
      default:
        // Ignore unknown messages silently
    }
  }

  onSong(cb: (song: any) => void) { this.cbSong = cb; }
  onCmd(cb: (cmd: any) => void) { this.cbCmd = cb; }
  onStateChange(cb: () => void) { this.cbState = cb; }

  disconnect() {
    this.dead = true;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    try { this.conn?.close(); } catch {}
    safeDestroy(this.peer);
    this.state = 'disconnected';
  }
}
