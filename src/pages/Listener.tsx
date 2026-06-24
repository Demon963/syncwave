import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { ListenerSync, getSyncedTime } from '@/lib/peerSync';
import {
  Headphones, Radio, Unlink, ArrowLeft, Volume2, Volume1, VolumeX,
  Loader2, Wifi, WifiOff, Music
} from 'lucide-react';
import type { SyncCmd } from '@/lib/peerSync';

// ─── Types ──────────────────────────────────────────────

interface Song {
  id: string;
  title: string;
  fileData: string;
  mimeType: string;
  duration: number;
  size: number;
  createdAt: number;
  createdBy: string;
}

// ─── IndexedDB Cache ────────────────────────────────────

const DB_NAME = 'SyncWaveCache_v3';
const STORE_SONGS = 'songs';

async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_SONGS)) {
        db.createObjectStore(STORE_SONGS, { keyPath: 'id' });
      }
    };
  });
}

async function dbGetAllSongs(): Promise<Song[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SONGS, 'readonly');
    const req = tx.objectStore(STORE_SONGS).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbSaveSong(song: Song): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SONGS, 'readwrite');
    const req = tx.objectStore(STORE_SONGS).put(song);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbGetSong(id: string): Promise<Song | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SONGS, 'readonly');
    const req = tx.objectStore(STORE_SONGS).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function base64ToBlobUrl(base64: string, mimeType: string): string {
  const byteChars = atob(base64);
  const byteNums = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
  return URL.createObjectURL(new Blob([byteNums], { type: mimeType }));
}

function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Component: Listener ────────────────────────────────

export default function Listener() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const audioRef = useRef<HTMLAudioElement>(null);
  const syncRef = useRef<ListenerSync | null>(null);
  const receivedSongsRef = useRef<Set<string>>(new Set());
  const pendingCmdRef = useRef<SyncCmd | null>(null);

  const [adminId, setAdminId] = useState(searchParams.get('room') || '');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'syncing' | 'ready' | 'disconnected' | 'error'>('idle');
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [trackName, setTrackName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [songCount, setSongCount] = useState(0);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0 });
  const [latency, setLatency] = useState(0);

  // ── Load initial song count ──
  useEffect(() => {
    dbGetAllSongs().then(songs => {
      setSongCount(songs.length);
      receivedSongsRef.current = new Set(songs.map(s => s.id));
    });
  }, []);

  // ── Audio progress ──
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      setCurrentTime(audio.currentTime);
      setDuration(audio.duration || 0);
      setProgress(audio.duration ? (audio.currentTime / audio.duration) * 100 : 0);
    };
    const onEnded = () => setIsPlaying(false);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnded);
    };
  }, [currentSong]);

  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume]);

  // ── Execute command ──
  const executeCommand = useCallback((cmd: SyncCmd) => {
    const audio = audioRef.current;
    if (!audio) return;

    switch (cmd.action) {
      case 'play': {
        dbGetSong(cmd.songId).then(song => {
          if (!song) {
            // Song not cached — queue and wait
            pendingCmdRef.current = cmd;
            setTrackName('جاري تحميل الأغنية...');
            return;
          }
          if (currentSong?.id !== song.id) {
            audio.src = base64ToBlobUrl(song.fileData, song.mimeType);
            setCurrentSong(song);
            setTrackName(song.title);
          }
          // Sync position using server timestamp
          const syncedTime = getSyncedTime(cmd);
          if (Math.abs(audio.currentTime - syncedTime) > 0.3) {
            audio.currentTime = syncedTime;
          }
          audio.play().then(() => setIsPlaying(true)).catch(() => {});
        });
        break;
      }
      case 'pause': {
        audio.pause();
        setIsPlaying(false);
        break;
      }
      case 'seek': {
        audio.currentTime = Math.max(0, cmd.time);
        break;
      }
      case 'track': {
        dbGetSong(cmd.songId).then(song => {
          if (!song) {
            pendingCmdRef.current = cmd;
            setTrackName('جاري تحميل الأغنية...');
            return;
          }
          audio.src = base64ToBlobUrl(song.fileData, song.mimeType);
          setCurrentSong(song);
          setTrackName(song.title);
          const syncedTime = getSyncedTime(cmd);
          audio.currentTime = syncedTime;
          audio.play().then(() => setIsPlaying(true)).catch(() => {});
        });
        break;
      }
    }
  }, [currentSong]);

  // ── Handle song received (sync) ──
  const handleSongReceived = useCallback(async (song: Song) => {
    if (!receivedSongsRef.current.has(song.id)) {
      await dbSaveSong(song);
      receivedSongsRef.current.add(song.id);
      setSongCount(prev => prev + 1);
      setSyncProgress(prev => ({ current: prev.current + 1, total: prev.total }));

      // Check if there's a pending command waiting for this song
      if (pendingCmdRef.current?.songId === song.id) {
        executeCommand(pendingCmdRef.current);
        pendingCmdRef.current = null;
      }
    }
  }, [executeCommand]);

  // ── Connect to admin ──
  const connect = useCallback(() => {
    const targetId = adminId.trim();
    if (!targetId) { setErrorMsg('أدخل معرف البث'); return; }

    setStatus('connecting');
    setErrorMsg('');

    const sync = new ListenerSync();
    syncRef.current = sync;

    sync.onStateChange(() => {
      setStatus(sync.state as any);
    });

    sync.onSong(async (song) => {
      await handleSongReceived(song);
    });

    sync.onCmd((cmd) => {
      executeCommand(cmd);
    });

    // Get known song IDs for incremental sync
    dbGetAllSongs().then(songs => {
      const knownIds = songs.map(s => s.id);
      sync.connect(targetId, knownIds);
    });
  }, [adminId, executeCommand, handleSongReceived]);

  // Auto-connect from URL
  useEffect(() => {
    if (searchParams.get('room')) {
      const timer = setTimeout(connect, 500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line
  }, []);

  // Cleanup
  useEffect(() => {
    return () => syncRef.current?.disconnect();
  }, []);

  const disconnect = () => {
    syncRef.current?.disconnect();
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
    setStatus('idle');
    setIsPlaying(false);
    setCurrentSong(null);
    setTrackName('');
  };

  const getVolumeIcon = () => {
    if (volume === 0) return <VolumeX className="w-4 h-4" />;
    if (volume < 0.5) return <Volume1 className="w-4 h-4" />;
    return <Volume2 className="w-4 h-4" />;
  };

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0A] text-white font-['Tajawal'] flex flex-col" dir="rtl">
      <audio ref={audioRef} crossOrigin="anonymous" playsInline />

      {/* Header */}
      <div className="sticky top-0 z-50 bg-[#0A0A0A]/95 backdrop-blur-xl border-b border-[#222222]/50">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between px-4 h-14">
          <button onClick={() => navigate('/')} className="p-2 -mr-2 hover:bg-white/5 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-[#A0A0A0]" />
          </button>
          <div className="flex items-center gap-2">
            <Headphones className="w-5 h-5 text-[#FF00FF]" />
            <span className="font-bold text-sm">مساحة المستمع</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${
              status === 'ready' ? 'bg-[#00FF66]' :
              status === 'connecting' || status === 'syncing' ? 'bg-[#FFAA00] animate-pulse' :
              status === 'error' || status === 'disconnected' ? 'bg-[#FF3366]' : 'bg-[#555555]'
            }`} />
            <span className="text-[10px] text-[#A0A0A0]">
              {status === 'ready' ? 'متزامن' : status === 'connecting' ? 'جاري الاتصال...' :
               status === 'syncing' ? 'جاري التحميل...' : status === 'error' ? 'خطأ' :
               status === 'disconnected' ? 'انقطع' : 'غير متصل'}
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center max-w-[1200px] mx-auto w-full px-4 py-8">
        {/* Waveform Visualizer */}
        <div className="relative mb-8 h-32 flex items-center justify-center">
          {status === 'ready' && (
            <motion.div className="absolute rounded-full" animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }} transition={{ duration: 2, repeat: Infinity }}
              style={{ background: 'radial-gradient(circle, rgba(255,0,255,0.2) 0%, transparent 70%)', width: 200, height: 200, top: '50%', left: '50%', marginTop: -100, marginLeft: -100 }} />
          )}
          <div className="flex items-center justify-center gap-[3px] h-20 w-40 relative z-10">
            {[...Array(16)].map((_, i) => (
              <motion.div key={i} className="w-1.5 rounded-full"
                style={{ background: status === 'ready' ? '#FF00FF' : status === 'connecting' || status === 'syncing' ? '#FFAA00' : '#333333' }}
                animate={status === 'ready' && isPlaying
                  ? { height: [10, 15 + Math.sin(i * 0.7) * 30, 10], opacity: [0.5, 1, 0.5] }
                  : status === 'syncing'
                  ? { height: [8, 22, 8], opacity: [0.3, 0.7, 0.3] }
                  : { height: 6, opacity: 0.3 }}
                transition={{ duration: status === 'syncing' ? 0.6 : 0.5 + Math.sin(i) * 0.3, repeat: Infinity, delay: i * 0.04 }} />
            ))}
          </div>
        </div>

        {/* Connection Form */}
        <AnimatePresence mode="wait">
          {(status === 'idle' || status === 'error' || status === 'disconnected') && (
            <motion.div key="connect" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="w-full max-w-sm">
              <div className="text-center mb-6">
                <Radio className="w-10 h-10 text-[#FF00FF] mx-auto mb-3" />
                <h2 className="text-lg font-bold mb-1">ادخل معرف البث</h2>
                <p className="text-[#A0A0A0] text-xs">من المسؤول</p>
              </div>
              <div className="space-y-3">
                <input type="text" value={adminId} onChange={e => setAdminId(e.target.value)} placeholder="مثال: abc123..."
                  className="w-full bg-[#111111] border border-[#222222] rounded-xl px-4 py-3.5 text-base text-center text-white placeholder-[#555555] focus:border-[#FF00FF] focus:outline-none font-mono"
                  onKeyDown={e => e.key === 'Enter' && connect()} />
                {errorMsg && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[#FF3366] text-xs text-center">{errorMsg}</motion.p>}
                <button onClick={connect} disabled={!adminId.trim()}
                  className="w-full bg-[#FF00FF] hover:bg-[#FF00FF]/80 disabled:opacity-40 disabled:cursor-not-allowed text-[#0A0A0A] font-bold py-3.5 rounded-xl active:scale-[0.98] transition-all">
                  اتصال بالبث
                </button>
              </div>
            </motion.div>
          )}

          {/* Syncing */}
          {status === 'syncing' && (
            <motion.div key="syncing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center">
              <motion.div className="w-10 h-10 border-2 border-[#FFAA00] border-t-transparent rounded-full mx-auto mb-3" animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} />
              <p className="text-[#FFAA00] text-sm font-bold mb-1">جاري تحميل الأغاني...</p>
              <p className="text-[#A0A0A0] text-xs">تم استلام {songCount} أغنية</p>
            </motion.div>
          )}

          {/* Connecting */}
          {status === 'connecting' && (
            <motion.div key="connecting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center">
              <Loader2 className="w-10 h-10 text-[#FF00FF] animate-spin mx-auto mb-3" />
              <p className="text-[#A0A0A0] text-sm">جاري الاتصال بالبث...</p>
            </motion.div>
          )}

          {/* Ready / Playing */}
          {status === 'ready' && (
            <motion.div key="ready" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full max-w-sm text-center">
              <div className="mb-6">
                <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#FF00FF]/30 to-[#00F0FF]/30 flex items-center justify-center">
                  {currentSong ? <Music className="w-10 h-10 text-white/80" /> : <Headphones className="w-10 h-10 text-white/80" />}
                </div>
                <h3 className="font-bold text-lg mb-1">{trackName || 'في انتظار البث...'}</h3>
                <div className="flex items-center justify-center gap-3">
                  <span className="text-[#00FF66] text-xs flex items-center gap-1">
                    <Wifi className="w-3.5 h-3.5" /> متصل
                  </span>
                  <span className="text-[#A0A0A0] text-xs">{songCount} أغنية</span>
                  {latency > 0 && <span className="text-[#A0A0A0] text-xs font-mono">{latency}ms</span>}
                </div>
                {!currentSong && (
                  <p className="text-[#A0A0A0] text-xs mt-3 max-w-[250px] mx-auto">
                    سيبدأ التشغيل تلقائياً عندما يشغل المسؤول أغنية
                  </p>
                )}
              </div>

              {/* Progress bar (READ-ONLY) */}
              {currentSong && (
                <div className="mb-6 px-4">
                  <div className="flex items-center justify-between text-[10px] text-[#A0A0A0] mb-1">
                    <span>{formatDuration(currentTime)}</span>
                    <span>{formatDuration(duration)}</span>
                  </div>
                  <div className="h-1 bg-[#333333] rounded-full overflow-hidden">
                    <motion.div className="h-full bg-[#FF00FF] rounded-full" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              )}

              {/* Volume (ONLY listener control) */}
              <div className="flex items-center gap-3 justify-center mb-6 max-w-[200px] mx-auto">
                <span className="text-[#A0A0A0]">{getVolumeIcon()}</span>
                <input type="range" min={0} max={1} step={0.01} value={volume}
                  onChange={e => setVolume(Number(e.target.value))}
                  className="flex-1 h-1 bg-[#333333] rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#FF00FF]"
                  style={{ background: `linear-gradient(to left, #FF00FF ${volume * 100}%, #333333 ${volume * 100}%)` }} />
              </div>

              {/* Disconnect */}
              <button onClick={disconnect}
                className="flex items-center gap-2 mx-auto text-[#FF3366] text-sm hover:bg-[#FF3366]/10 px-4 py-2 rounded-lg transition-colors">
                <Unlink className="w-4 h-4" /> قطع الاتصال
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
