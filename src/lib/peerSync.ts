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
    host: '0.peerjs.com',
    port: 443,
    secure: true,
    config: { iceServers: ICE_SERVERS, iceCandidatePoolSize: 10 },
    debug: 2,
  };
}

export function now() { return performance.now(); }

function loadP(): Promise<void> {
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

export function getSyncedTime(cmd: { time: number; ts: number }, clockOffset: number = 0) {
  return cmd.time + (now() - (cmd.ts - clockOffset)) / 1000;
}

const med = (arr: number[]) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function cleanup(p: any) { try { p?.destroy(); } catch {} }

// ─── ADMIN ──────────────────────────────────────────────

export class AdminSync {
  peer: any;
  roomCode: string = '';
  adminPeerId: string = '';
  state: 'connecting' | 'ready' | 'error' = 'connecting';
  errorMessage: string = '';
  private L: Map<string, any> = new Map();
  private cbS?: () => void;
  private cbN?: (id: string) => void;
  private PC: any;
  private dead: boolean = false;
  private songs: Map<string, any> = new Map();

  constructor(roomCode: string) {
    this.roomCode = roomCode;
    this.adminPeerId = `sw_${roomCode}`;
    this.PC = (window as any).Peer;
    if (!this.PC) {
      loadP()
        .then(() => { this.PC = (window as any).Peer; this.init(); })
        .catch(() => { this.state = 'error'; this.errorMessage = 'فشل تحميل PeerJS'; this.cbS?.(); });
    } else {
      this.init();
    }
  }

  private async init(attempt: number = 0) {
    if (this.dead) return;
    console.log('[A] Init attempt', attempt, 'PeerID:', this.adminPeerId);
    try {
      this.peer = new this.PC(this.adminPeerId, getCfg());

      // Wait for peer to be fully registered on broker
      await new Promise<void>((res, rej) => {
        const to = setTimeout(() => rej(new Error('peer-open-timeout')), 15000);
        this.peer.on('open', () => { clearTimeout(to); res(); });
        this.peer.on('error', (e: any) => { clearTimeout(to); rej(e); });
      });

      console.log('[A] Peer open, waiting for broker propagation...');
      await sleep(3000); // Allow broker cluster to propagate

      this.state = 'ready';
      this.errorMessage = '';
      console.log('[A] Ready:', this.adminPeerId);
      this.cbS?.();

      this.peer.on('connection', (c: any) => {
        console.log('[A] Incoming conn from:', c.peer);
        c.on('open', () => {
          console.log('[A] Conn opened by:', c.peer);
          this.hConn(c);
        });
        c.on('error', (e: any) => console.error('[A] Conn error:', e));
      });

      this.peer.on('error', (e: any) => this.onPeerError(e, attempt));
      this.peer.on('disconnected', () => {
        console.log('[A] Broker disconnected, reconnecting...');
        this.peer?.reconnect();
      });
    } catch (e: any) {
      console.error('[A] Init failed:', e?.type || e?.message || e);
      if (e?.type === 'unavailable-id' && attempt < 15) {
        this.errorMessage = `الرمز ${this.roomCode} يتزامن (${attempt + 1}/15)...`;
        this.state = 'connecting';
        this.cbS?.();
        await sleep(4000);
        if (!this.dead) { cleanup(this.peer); this.init(attempt + 1); }
      } else if (e?.type === 'unavailable-id') {
        this.state = 'error';
        this.errorMessage = `الرمز ${this.roomCode} غير متاح. أغلق الصفحة وأعد فتحها.`;
        this.cbS?.();
      } else if (e?.message === 'peer-open-timeout') {
        this.state = 'error';
        this.errorMessage = 'انتهى وقت الاتصال بـ broker. أعد المحاولة.';
        this.cbS?.();
      } else {
        this.state = 'error';
        this.errorMessage = 'خطأ: ' + (e?.type || e?.message || 'غير معروف');
        this.cbS?.();
      }
    }
  }

  private onPeerError(e: any, attempt: number) {
    console.error('[A] Peer err:', e.type, e.message);
    if (e.type === 'disconnected') {
      this.peer?.reconnect();
    } else if (e.type === 'network' || e.type === 'socket-error') {
      // Non-fatal, keep trying
    } else if (e.type === 'unavailable-id') {
      // Already handled in init
    }
  }

  private async hConn(c: any) {
    console.log('[A] Handling conn from:', c.peer, 'songs:', this.songs.size);
    const e = { conn: c, off: 0 };
    this.L.set(c.peer, e);

    try {
      const r = await this.calib(c);
      e.off = r;
      console.log('[A] Clock offset:', r);
    } catch (err) {
      console.error('[A] Calib error:', err);
    }

    c.on('close', () => {
      console.log('[A] Conn closed:', c.peer);
      this.L.delete(c.peer);
      this.cbS?.();
    });

    c.on('error', (err: any) => {
      console.error('[A] Conn error:', c.peer, err);
      this.L.delete(c.peer);
      this.cbS?.();
    });

    c.on('data', (msg: any) => {
      console.log('[A] Data from', c.peer, 'type:', msg.t);
      if (msg.t === 'requestSync') this.sndAll(c);
    });

    console.log('[A] Sending', this.songs.size, 'songs to', c.peer);
    this.sndAll(c);
    this.cbN?.(c.peer);
    this.cbS?.();
  }

  private async sndAll(c: any) {
    const songs = Array.from(this.songs.values());
    if (!songs.length) {
      if (c.open) {
        console.log('[A] No songs, sending syncDone');
        c.send({ t: 'sd' });
      }
      return;
    }
    for (const s of songs) {
      if (!c.open) { console.log('[A] Conn closed mid-send'); break; }
      await this.sndSong(c, s);
    }
    if (c.open) {
      console.log('[A] All songs sent, sending syncDone');
      c.send({ t: 'sd' });
    }
  }

  private async sndSong(c: any, song: any) {
    const sz = 16000;
    const chunks: string[] = [];
    for (let i = 0; i < song.fileData.length; i += sz) {
      chunks.push(song.fileData.slice(i, i + sz));
    }
    console.log('[A] Sending song:', song.title, 'chunks:', chunks.length);
    c.send({
      t: 'sm',
      meta: {
        id: song.id,
        title: song.title,
        mimeType: song.mimeType,
        duration: song.duration,
        size: song.size,
        tc: chunks.length
      }
    });
    await sleep(30);
    for (let i = 0; i < chunks.length; i++) {
      if (!c.open) { console.log('[A] Conn closed during chunks'); return; }
      c.send({ t: 'sc', sid: song.id, idx: i, d: chunks[i] });
      if (i % 50 === 0) await sleep(10);
    }
    await sleep(20);
    if (c.open) c.send({ t: 'sdone', sid: song.id });
  }

  addSong(song: any) {
    console.log('[A] addSong:', song.title);
    this.songs.set(song.id, song);
    this.L.forEach((e: any) => { if (e.conn.open) this.sndSong(e.conn, song); });
  }

  sendCommand(action: string, songId: string, time: number) {
    const ts = now();
    this.L.forEach((e: any) => {
      if (e.conn.open) e.conn.send({ t: 'cmd', action, songId, time, ts, offset: e.off });
    });
  }

  getListenerCount(): number {
    let c = 0;
    this.L.forEach((e: any) => { if (e.conn?.open) c++; });
    return c;
  }

  onStateChange(cb: () => void) { this.cbS = cb; }
  onNewListener(cb: (id: string) => void) { this.cbN = cb; }
  destroy() {
    this.dead = true;
    this.L.forEach((e: any) => { try { e.conn?.close(); } catch {} });
    cleanup(this.peer);
  }

  private async calib(c: any) {
    const o: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = now();
      c.send({ t: 'cs', tm: t0 });

      const r = await new Promise<number>((res) => {
        const h = (msg: any) => {
          if (msg.t === 'csr' && Math.abs(msg.tm - t0) < 1) {
            c.off('data', h);
            res(now());
          }
        };
        c.on('data', h);
        setTimeout(() => { c.off('data', h); res(t0); }, 800);
      });

      if (r > t0) {
        const rtt = r - t0;
        o.push(t0 + rtt / 2);
      }

      const rp = await new Promise<{ t2: number; l1: number }>((res) => {
        const h2 = (msg: any) => {
          if (msg.t === 'csr' && Math.abs(msg.tm - t0) < 1) {
            c.off('data', h2);
            res({ t2: r || now(), l1: msg.l1 });
          }
        };
        c.on('data', h2);
        setTimeout(() => { c.off('data', h2); res({ t2: t0, l1: 0 }); }, 800);
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
  errorMessage: string = '';
  private cbSong?: (song: any) => void;
  private cbCmd?: (cmd: any) => void;
  private cbState?: () => void;
  private PC: any;
  private dead: boolean = false;
  private rx: Map<string, any> = new Map();
  private timer: any = null;

  constructor() { this.PC = (window as any).Peer; }

  async connect(roomCode: string, knownSongIds: string[]) {
    this.errorMessage = '';
    console.log('[L] Connect to room:', roomCode);
    this.state = 'connecting';
    this.dead = false;
    this.rx.clear();
    if (this.timer) clearTimeout(this.timer);

    try {
      if (!this.PC) {
        await loadP();
        this.PC = (window as any).Peer;
      }
      this.init(roomCode, knownSongIds);
    } catch (e) {
      console.error('[L] Initial fail:', e);
      this.state = 'error';
      this.errorMessage = 'فشل تحميل PeerJS';
      this.cbState?.();
    }
  }

  private async init(roomCode: string, kids: string[], att: number = 0) {
    if (this.dead) return;
    const adminPeerId = `sw_${roomCode}`;
    console.log('[L] Init peer, attempt:', att + 1);

    try {
      this.peer = new this.PC(undefined, getCfg());

      // Wait for peer to open
      await new Promise<void>((res, rej) => {
        const to = setTimeout(() => rej(new Error('peer-open-timeout')), 15000);
        this.peer.on('open', () => { clearTimeout(to); res(); });
        this.peer.on('error', (e: any) => { if (e.type !== 'disconnected') { clearTimeout(to); rej(e); } });
      });

      console.log('[L] Peer open:', this.peer.id);
      await sleep(2000); // Let broker settle
      this.dc(adminPeerId, kids, 0);

      this.peer.on('disconnected', () => { this.peer?.reconnect(); });
      this.peer.on('error', (e: any) => {
        if (e.type === 'disconnected') { this.peer?.reconnect(); return; }
        console.error('[L] Peer err:', e.type, e.message);
      });
    } catch (e: any) {
      console.error('[L] Peer init error:', e?.type || e?.message || e);
      if (e?.message === 'peer-open-timeout') {
        this.state = 'error';
        this.errorMessage = 'انتهى وقت الاتصال. تحقق من الإنترنت.';
        this.cbState?.();
      } else if (att < 3) {
        console.log('[L] Retrying peer init...');
        cleanup(this.peer);
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
    console.log('[L] Connecting to admin:', aid, 'attempt:', att + 1);

    try {
      this.conn = this.peer.connect(aid, { reliable: true });
    } catch (e) {
      console.error('[L] peer.connect threw:', e);
      this.retryOrFail(aid, kids, att);
      return;
    }

    let connected = false;
    const to = setTimeout(() => {
      if (connected || this.dead) return;
      console.log('[L] Timeout attempt', att + 1);
      try { this.conn.close(); } catch {}
      this.retryOrFail(aid, kids, att);
    }, 15000);

    this.conn.on('open', () => {
      connected = true;
      clearTimeout(to);
      console.log('[L] Connected to admin!');
      this.state = 'syncing';
      this.cbState?.();
      try {
        this.conn.send({ t: 'requestSync', kids });
      } catch (e) {
        console.error('[L] Send error:', e);
      }
      this.timer = setTimeout(() => {
        if (this.state === 'syncing' && !this.dead) {
          console.log('[L] Force ready (no songs)');
          this.state = 'ready';
          this.cbState?.();
        }
      }, 8000);
    });

    this.conn.on('data', (msg: any) => this.onD(msg));

    this.conn.on('close', () => {
      clearTimeout(to);
      if (this.timer) clearTimeout(this.timer);
      console.log('[L] Conn closed');
      if (!this.dead && this.state !== 'error') {
        this.state = 'disconnected';
        this.cbState?.();
      }
    });

    this.conn.on('error', (e: any) => {
      clearTimeout(to);
      console.error('[L] Conn error:', e);
      if (!connected) this.retryOrFail(aid, kids, att);
    });
  }

  private retryOrFail(aid: string, kids: string[], att: number) {
    if (att < 10) {
      const delay = Math.min(2000 + att * 500, 6000);
      console.log(`[L] Retry ${att + 2}/11 in ${delay}ms`);
      setTimeout(() => { if (!this.dead) this.dc(aid, kids, att + 1); }, delay);
    } else {
      console.log('[L] All retries failed');
      cleanup(this.peer);
      this.state = 'error';
      this.errorMessage = 'تعذر الاتصال بالمسؤول. تأكد من صحة الرمز وأن المسؤول متصل.';
      this.cbState?.();
    }
  }

  private onD(msg: any) {
    switch (msg.t) {
      case 'sm': {
        console.log('[L] Meta:', msg.meta.title);
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
        const bad = r.c.map((c: string, i: number) => c === '' ? i : -1).filter((i: number) => i >= 0);
        if (bad.length) { console.warn('[L] Missing chunks:', bad); this.rx.delete(msg.sid); break; }
        const song = { ...r.m, fileData: r.c.join(''), createdAt: Date.now() };
        this.rx.delete(msg.sid);
        console.log('[L] Song ready:', song.title);
        this.cbSong?.(song);
        if (this.state === 'syncing') { this.state = 'ready'; this.cbState?.(); }
        break;
      }
      case 'sd': {
        console.log('[L] syncDone');
        if (this.timer) clearTimeout(this.timer);
        if (this.state === 'syncing' && !this.dead) {
          this.state = 'ready';
          this.cbState?.();
        }
        break;
      }
      case 'cmd': {
        this.cbCmd?.({ ...msg, _listenerOffset: msg.offset || 0 });
        break;
      }
      case 'cs': {
        this.conn?.send({ t: 'csr', tm: msg.tm, l1: now() });
        break;
      }
      default:
        console.log('[L] Unknown:', msg.t);
    }
  }

  onSong(cb: (song: any) => void) { this.cbSong = cb; }
  onCmd(cb: (cmd: any) => void) { this.cbCmd = cb; }
  onStateChange(cb: () => void) { this.cbState = cb; }
  disconnect() {
    this.dead = true;
    if (this.timer) clearTimeout(this.timer);
    try { this.conn?.close(); } catch {}
    cleanup(this.peer);
    this.state = 'disconnected';
  }
}
