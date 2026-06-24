import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { ListenerSync, computeTargetPosition } from '@/lib/peerSync';
import {
  Headphones, ArrowLeft, Volume2, Volume1, VolumeX,
  Loader2, Wifi, Music, Radio, Activity, LogIn
} from 'lucide-react';

interface Song {
  id: string;
  title: string;
  fileData: string;
  mimeType: string;
  duration: number;
  size: number;
  createdAt: number;
}

// ─── IndexedDB ──────────────────────────────────────────

const DB_NAME = 'SyncWaveCache_v3';
const STORE = 'songs';

async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
  });
}

async function dbGetAllSongs(): Promise<Song[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbSaveSong(song: Song): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(song);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbGetSong(id: string): Promise<Song | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function base64ToBlobUrl(base64: string, mimeType: string): string {
  const chars = atob(base64);
  const nums = new Uint8Array(chars.length);
  for (let i = 0; i < chars.length; i++) nums[i] = chars.charCodeAt(i);
  return URL.createObjectURL(new Blob([nums], { type: mimeType }));
}

function fmtDuration(s: number): string {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ─── OTP Code Input Component ───────────────────────────

function CodeInput({ onSubmit, disabled }: { onSubmit: (code: string) => void; disabled: boolean }) {
  const [digits, setDigits] = useState(['', '', '']);
  const [focused, setFocused] = useState(0);
  const [errorShake, setErrorShake] = useState(false);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-focus first input on mount
  useEffect(() => {
    setTimeout(() => inputsRef.current[0]?.focus(), 300);
  }, []);

  const triggerShake = () => {
    setErrorShake(true);
    setTimeout(() => setErrorShake(false), 500);
  };

  const handleSubmit = useCallback((code: string) => {
    if (code.length !== 3 || disabled) { triggerShake(); return; }
    onSubmit(code);
  }, [onSubmit, disabled]);

  const setDigit = (i: number, val: string) => {
    const v = val.replace(/\D/g, '').slice(0, 1);
    if (!v) return;
    const next = [...digits]; next[i] = v; setDigits(next);
    const code = next.join('');
    if (i < 2) {
      setFocused(i + 1);
      setTimeout(() => inputsRef.current[i + 1]?.focus(), 10);
    }
    if (code.length === 3) setTimeout(() => handleSubmit(code), 150);
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key >= '0' && e.key <= '9') { e.preventDefault(); setDigit(i, e.key); return; }
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (digits[i]) {
        const next = [...digits]; next[i] = ''; setDigits(next);
      } else if (i > 0) {
        setFocused(i - 1);
        inputsRef.current[i - 1]?.focus();
        const next = [...digits]; next[i - 1] = ''; setDigits(next);
      }
      return;
    }
    if (e.key === 'ArrowLeft' && i > 0) { inputsRef.current[i - 1]?.focus(); setFocused(i - 1); }
    if (e.key === 'ArrowRight' && i < 2) { inputsRef.current[i + 1]?.focus(); setFocused(i + 1); }
    if (e.key === 'Enter') handleSubmit(digits.join(''));
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 3);
    if (pasted.length >= 3) {
      setDigits(pasted.split('').slice(0, 3));
      setTimeout(() => handleSubmit(pasted.slice(0, 3)), 150);
    } else if (pasted.length > 0) {
      const next = ['', '', ''];
      for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
      setDigits(next);
      setFocused(pasted.length);
      setTimeout(() => inputsRef.current[pasted.length]?.focus(), 10);
    }
  };

  return (
    <div className="text-center w-full max-w-xs">
      <h2 className="font-bold text-xl mb-1 text-white">أدخل رمز الغرفة</h2>
      <p className="text-[#555555] text-xs mb-5">اطلب الرمز المكون من 3 أرقام من المسؤول</p>

      <div
        ref={containerRef}
        className={`flex gap-2 justify-center mb-5 ${errorShake ? 'animate-shake' : ''}`}
        onPaste={handlePaste}
      >
        {[0, 1, 2].map(i => (
          <input
            key={i}
            ref={el => { inputsRef.current[i] = el; }}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={1}
            value={digits[i]}
            disabled={disabled}
            onChange={e => { e.preventDefault(); setDigit(i, e.target.value); }}
            onKeyDown={e => handleKeyDown(i, e)}
            onFocus={() => setFocused(i)}
            className={`
              w-16 h-20 bg-[#111111] border-2 rounded-2xl text-center text-3xl font-bold font-mono
              transition-all duration-200 outline-none
              ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
              ${digits[i] ? 'border-[#00FF66] text-[#00FF66]' : focused === i ? 'border-[#FF00FF] text-white' : 'border-[#222222] text-white'}
            `}
            style={{ caretColor: 'transparent' }}
          />
        ))}
      </div>

      <button
        onClick={() => handleSubmit(digits.join(''))}
        disabled={disabled || digits.join('').length !== 3}
        className="w-full bg-[#FF00FF] hover:bg-[#FF00FF]/80 disabled:opacity-30 disabled:cursor-not-allowed text-[#0A0A0A] font-bold py-3.5 rounded-xl active:scale-[0.97] transition-all text-sm flex items-center justify-center gap-2"
      >
        {disabled ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
        {disabled ? 'جاري الاتصال...' : 'اتصال'}
      </button>
    </div>
  );
}

// ─── Main Listener ──────────────────────────────────────

export default function Listener() {
  const navigate = useNavigate();
  const audioRef = useRef<HTMLAudioElement>(null);
  const syncRef = useRef<ListenerSync | null>(null);
  const pendingCmdRef = useRef<any>(null);

  const [status, setStatus] = useState<'idle' | 'connecting' | 'syncing' | 'ready' | 'error' | 'disconnected'>('idle');
  const [roomCode, setRoomCode] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(() => { const s = localStorage.getItem('sw_lvol'); return s ? parseFloat(s) : 0.8; });
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [trackName, setTrackName] = useState('');
  const [songCount, setSongCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [searchParams] = useSearchParams();

  // Load cached songs count
  useEffect(() => {
    dbGetAllSongs().then(songs => setSongCount(songs.length));
  }, []);

  // Audio
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => {
      setCurrentTime(a.currentTime);
      setDuration(a.duration || 0);
      setProgress(a.duration ? (a.currentTime / a.duration) * 100 : 0);
    };
    const onEnd = () => setIsPlaying(false);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onEnd);
    return () => { a.removeEventListener('timeupdate', onTime); a.removeEventListener('ended', onEnd); };
  }, [currentSong]);

  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume]);
  useEffect(() => { localStorage.setItem('sw_lvol', volume.toString()); }, [volume]);

  // Auto-connect from URL ?room=CODE
  useEffect(() => {
    const code = searchParams.get('room');
    if (code && /^\d{3}$/.test(code)) {
      setRoomCode(code);
      connectToRoom(code);
    }
  }, [searchParams]);

  // Connect to room
  const connectToRoom = useCallback((code: string) => {
    if (!code || !/^\d{3}$/.test(code)) return;
    setRoomCode(code); setErrorMsg('');

    // Disconnect previous if any
    syncRef.current?.disconnect();

    const sync = new ListenerSync();
    syncRef.current = sync;

    sync.onStateChange(() => {
      const s = sync.state;
      setStatus(s === 'connecting' ? 'connecting' : s === 'syncing' ? 'syncing' : s === 'ready' ? 'ready' : s === 'disconnected' ? 'disconnected' : 'error');
      if (s === 'error') setErrorMsg(sync.errorMessage || 'فشل الاتصال');
    });

    sync.onSong(async (song) => {
      await dbSaveSong(song);
      setSongCount(prev => prev + 1);
      if (pendingCmdRef.current?.songId === song.id) {
        executeCmd(pendingCmdRef.current);
        pendingCmdRef.current = null;
      }
    });

    sync.onCmd((cmd) => executeCmd(cmd));

    dbGetAllSongs().then(songs => {
      sync.connect(code, songs.map(s => s.id));
    });
  }, []);

  const executeCmd = useCallback((cmd: any) => {
    const a = audioRef.current;
    if (!a) return;

    // Use admin-provided offset for precise sync
    // offset = listener_clock - admin_clock
    // position = cmd.time + (listener_now - (cmd.ts + offset)) / 1000
    const offset = cmd._listenerOffset || 0;
    const { position, delayMs } = computeTargetPosition(cmd, offset);

    console.log(`[Sync] action=${cmd.action} pos=${position.toFixed(3)}s delay=${delayMs.toFixed(1)}ms offset=${offset.toFixed(1)}ms`);

    switch (cmd.action) {
      case 'play': {
        dbGetSong(cmd.songId).then(song => {
          if (!song) { pendingCmdRef.current = cmd; setTrackName('جاري تحميل الأغنية...'); return; }
          if (currentSong?.id !== song.id) { a.src = base64ToBlobUrl(song.fileData, song.mimeType); setCurrentSong(song); setTrackName(song.title); }
          // Only seek if drift > 50ms to avoid jitter
          if (Math.abs(a.currentTime - position) > 0.05) a.currentTime = position;
          a.play().then(() => setIsPlaying(true)).catch(() => {});
        });
        break;
      }
      case 'pause': { a.pause(); setIsPlaying(false); break; }
      case 'seek': { a.currentTime = position; break; }
      case 'track': {
        dbGetSong(cmd.songId).then(song => {
          if (!song) { pendingCmdRef.current = cmd; setTrackName('جاري تحميل الأغنية...'); return; }
          a.src = base64ToBlobUrl(song.fileData, song.mimeType); setCurrentSong(song); setTrackName(song.title);
          a.currentTime = position; a.play().then(() => setIsPlaying(true)).catch(() => {});
        });
        break;
      }
    }
  }, [currentSong]);

  const disconnect = () => {
    syncRef.current?.disconnect();
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
    setStatus('idle'); setIsPlaying(false); setCurrentSong(null); setTrackName(''); setErrorMsg('');
  };

  const statusConfig: Record<string, { color: string; label: string; icon: any; sublabel: string }> = {
    idle: { color: '#555555', label: 'في الانتظار', icon: <Headphones className="w-8 h-8" />, sublabel: 'أدخل رمز الغرفة للانضمام' },
    connecting: { color: '#FFAA00', label: 'جاري الاتصال...', icon: <Loader2 className="w-8 h-8 animate-spin" />, sublabel: 'يتصل بالمسؤول' },
    syncing: { color: '#00F0FF', label: 'جاري التحميل...', icon: <Loader2 className="w-8 h-8 animate-spin" />, sublabel: 'استلام الأغاني من المسؤول' },
    ready: { color: '#00FF66', label: 'متصل ومزامن', icon: <Wifi className="w-8 h-8" />, sublabel: 'في انتظار تشغيل الأغاني' },
    disconnected: { color: '#FF3366', label: 'انقطع الاتصال', icon: <Activity className="w-8 h-8" />, sublabel: 'انقطع الاتصال بالمسؤول' },
    error: { color: '#FF3366', label: 'خطأ في الاتصال', icon: <Activity className="w-8 h-8" />, sublabel: errorMsg || 'تأكد من الرمز وحاول مرة أخرى' },
  };

  const sc = statusConfig[status] || statusConfig.idle;

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0A] text-white font-['Tajawal'] flex flex-col" dir="rtl">
      <audio ref={audioRef} crossOrigin="anonymous" playsInline />

      {/* Header */}
      <div className="sticky top-0 z-50 bg-[#0A0A0A]/95 backdrop-blur-xl border-b border-[#222222]/50">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between px-4 h-14">
          <button onClick={() => navigate('/')} className="p-2 hover:bg-white/5 rounded-lg transition-colors"><ArrowLeft className="w-5 h-5 text-[#A0A0A0]" /></button>
          <div className="flex items-center gap-2">
            <Headphones className="w-5 h-5 text-[#FF00FF]" />
            <span className="font-bold text-sm">مستمع</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: sc.color }} />
            <span className="text-[10px] text-[#A0A0A0]">{sc.label}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center max-w-[1200px] mx-auto w-full px-4 py-8">
        {/* Status Icon */}
        <div className="relative mb-6 h-28 flex items-center justify-center">
          <motion.div className="absolute rounded-full" animate={{ scale: [1, 1.3, 1], opacity: [0.2, 0.4, 0.2] }} transition={{ duration: 2, repeat: Infinity }}
            style={{ background: `radial-gradient(circle, ${sc.color}33 0%, transparent 70%)`, width: 180, height: 180, top: '50%', left: '50%', marginTop: -90, marginLeft: -90 }} />
          <div className="relative z-10" style={{ color: sc.color }}>
            {sc.icon}
          </div>
        </div>

        {/* Room Code Input OR Connected Status */}
        {status === 'idle' || status === 'error' || status === 'disconnected' ? (
          <div className="w-full max-w-xs">
            <CodeInput onSubmit={connectToRoom} disabled={status === 'connecting'} />
            {status === 'error' && (
              <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="mt-4 bg-[#FF3366]/10 border border-[#FF3366]/30 rounded-xl p-3 text-center">
                <p className="text-[#FF3366] text-xs">{errorMsg}</p>
                <button onClick={() => { setStatus('idle'); setErrorMsg(''); }} className="mt-2 text-[#FF00FF] text-xs font-bold hover:underline">إعادة المحاولة</button>
              </motion.div>
            )}
            {status === 'disconnected' && (
              <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="mt-4 text-center">
                <p className="text-[#A0A0A0] text-xs mb-2">انقطع الاتصال</p>
                <button onClick={() => connectToRoom(roomCode)} className="text-[#FF00FF] text-xs font-bold hover:underline">إعادة الاتصال</button>
              </motion.div>
            )}
          </div>
        ) : (
          <div className="text-center w-full max-w-xs">
            <h2 className="font-bold text-lg mb-1" style={{ color: sc.color }}>{sc.label}</h2>
            <p className="text-[#555555] text-xs mb-4">{sc.sublabel}</p>
            {status === 'connecting' && (
              <p className="text-[10px] text-[#444444] font-mono mb-1">sw_{roomCode}</p>
            )}

            {/* Track Info */}
            <div className="mb-6">
              <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#FF00FF]/30 to-[#00F0FF]/30 flex items-center justify-center">
                {currentSong ? <Music className="w-10 h-10 text-white/80" /> : <Headphones className="w-10 h-10 text-white/80" />}
              </div>
              <h3 className="font-bold text-lg mb-1">{trackName || 'في انتظار البث...'}</h3>
              <div className="flex items-center justify-center gap-3">
                <span className="text-[#00FF66] text-xs flex items-center gap-1"><Wifi className="w-3.5 h-3.5" /> متصل</span>
                <span className="text-[#555555] text-xs">{songCount} أغنية</span>
              </div>
              {!currentSong && status === 'ready' && (
                <p className="text-[#555555] text-xs mt-3">سيبدأ التشغيل تلقائياً</p>
              )}
            </div>

            {/* Progress */}
            {currentSong && (
              <div className="mb-6 px-4">
                <div className="flex items-center justify-between text-[10px] text-[#A0A0A0] mb-1">
                  <span>{fmtDuration(currentTime)}</span>
                  <span>{fmtDuration(duration)}</span>
                </div>
                <div className="w-full h-1 bg-[#333333] rounded-full overflow-hidden">
                  <div className="h-full bg-[#FF00FF] rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}

            {/* Volume + Disconnect */}
            <div className="flex items-center gap-3 justify-center">
              {volume === 0 ? <VolumeX className="w-4 h-4 text-[#A0A0A0]" /> : volume < 0.5 ? <Volume1 className="w-4 h-4 text-[#A0A0A0]" /> : <Volume2 className="w-4 h-4 text-[#A0A0A0]" />}
              <input type="range" min={0} max={1} step={0.01} value={volume}
                onChange={e => setVolume(Number(e.target.value))}
                className="w-24 h-1 bg-[#333333] rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#A0A0A0]" />
              <button onClick={disconnect} className="text-[#FF3366] text-xs hover:text-[#FF3366]/80 transition-colors mr-2 flex items-center gap-1">
                <Radio className="w-4 h-4" /> قطع
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
