import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { ListenerSync, getSyncedTime, FIXED_ROOM_ID } from '@/lib/peerSync';
import type { SyncCmd } from '@/lib/peerSync';
import {
  Headphones, Unlink, ArrowLeft, Volume2, Volume1, VolumeX,
  Loader2, Wifi, Music, Radio, Activity
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

// ─── Main Listener ──────────────────────────────────────

export default function Listener() {
  const navigate = useNavigate();
  const audioRef = useRef<HTMLAudioElement>(null);
  const syncRef = useRef<ListenerSync | null>(null);
  const pendingCmdRef = useRef<SyncCmd | null>(null);

  const [status, setStatus] = useState<'connecting' | 'syncing' | 'ready' | 'error' | 'disconnected'>('connecting');
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(() => { const s = localStorage.getItem('sw_lvol'); return s ? parseFloat(s) : 0.8; });
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [trackName, setTrackName] = useState('');
  const [songCount, setSongCount] = useState(0);
  const [latency, setLatency] = useState(0);

  // Load cached songs
  useEffect(() => {
    dbGetAllSongs().then(songs => {
      setSongCount(songs.length);
    });
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

  // Auto-connect on mount
  useEffect(() => {
    const sync = new ListenerSync();
    syncRef.current = sync;

    sync.onStateChange(() => {
      setStatus(sync.state as any);
      setLatency(sync.latency);
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
      sync.connect(songs.map(s => s.id));
    });

    return () => sync.disconnect();
    // eslint-disable-next-line
  }, []);

  const executeCmd = useCallback((cmd: SyncCmd) => {
    const a = audioRef.current;
    if (!a) return;

    const targetTime = getSyncedTime(cmd);

    switch (cmd.action) {
      case 'play': {
        dbGetSong(cmd.songId).then(song => {
          if (!song) {
            pendingCmdRef.current = cmd;
            setTrackName('جاري تحميل الأغنية...');
            return;
          }
          if (currentSong?.id !== song.id) {
            a.src = base64ToBlobUrl(song.fileData, song.mimeType);
            setCurrentSong(song);
            setTrackName(song.title);
          }
          if (Math.abs(a.currentTime - targetTime) > 0.1) a.currentTime = targetTime;
          a.play().then(() => setIsPlaying(true)).catch(() => {});
        });
        break;
      }
      case 'pause': {
        a.pause();
        setIsPlaying(false);
        break;
      }
      case 'seek': {
        a.currentTime = targetTime;
        break;
      }
      case 'track': {
        dbGetSong(cmd.songId).then(song => {
          if (!song) {
            pendingCmdRef.current = cmd;
            setTrackName('جاري تحميل الأغنية...');
            return;
          }
          a.src = base64ToBlobUrl(song.fileData, song.mimeType);
          setCurrentSong(song);
          setTrackName(song.title);
          a.currentTime = targetTime;
          a.play().then(() => setIsPlaying(true)).catch(() => {});
        });
        break;
      }
    }
  }, [currentSong]);

  const disconnect = () => {
    syncRef.current?.disconnect();
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
    setStatus('disconnected');
    setIsPlaying(false);
    setCurrentSong(null);
    setTrackName('');
  };

  const reconnect = () => {
    syncRef.current?.disconnect();
    setStatus('connecting');
    const sync = new ListenerSync();
    syncRef.current = sync;

    sync.onStateChange(() => {
      setStatus(sync.state as any);
      setLatency(sync.latency);
    });

    sync.onSong(async (song) => {
      await dbSaveSong(song);
      setSongCount(prev => prev + 1);
    });

    sync.onCmd((cmd) => executeCmd(cmd));

    dbGetAllSongs().then(songs => sync.connect(songs.map(s => s.id)));
  };

  const volIcon = volume === 0 ? <VolumeX className="w-4 h-4" /> : volume < 0.5 ? <Volume1 className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />;

  const statusConfig: Record<string, { color: string; label: string; icon: any }> = {
    connecting: { color: '#FFAA00', label: 'جاري الاتصال...', icon: <Loader2 className="w-8 h-8 animate-spin" /> },
    syncing: { color: '#FFAA00', label: 'جاري التحميل...', icon: <Loader2 className="w-8 h-8 animate-spin" /> },
    ready: { color: '#00FF66', label: 'متزامن', icon: <Wifi className="w-8 h-8" /> },
    disconnected: { color: '#FF3366', label: 'انقطع الاتصال', icon: <Activity className="w-8 h-8" /> },
    error: { color: '#FF3366', label: 'خطأ في الاتصال', icon: <Activity className="w-8 h-8" /> },
  };

  const sc = statusConfig[status] || statusConfig.connecting;

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0A] text-white font-['Tajawal'] flex flex-col" dir="rtl">
      <audio ref={audioRef} crossOrigin="anonymous" playsInline />

      {/* Header */}
      <div className="sticky top-0 z-50 bg-[#0A0A0A]/95 backdrop-blur-xl border-b border-[#222222]/50">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between px-4 h-14">
          <button onClick={() => navigate('/')} className="p-2 hover:bg-white/5 rounded-lg"><ArrowLeft className="w-5 h-5 text-[#A0A0A0]" /></button>
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

        {/* Room Info */}
        <div className="text-center mb-4">
          <div className="flex items-center justify-center gap-2 text-[10px] text-[#555555] font-mono mb-1">
            <Radio className="w-3 h-3" />
            {FIXED_ROOM_ID}
          </div>
          {latency > 0 && <span className="text-[10px] text-[#555555] font-mono">{latency}ms</span>}
        </div>

        <AnimatePresence mode="wait">
          {/* Connecting / Syncing */}
          {(status === 'connecting' || status === 'syncing') && (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center">
              <p className="text-sm font-bold mb-1" style={{ color: sc.color }}>{sc.label}</p>
              <p className="text-[#555555] text-xs">{songCount} أغنية مخزنة</p>
            </motion.div>
          )}

          {/* Ready / Playing */}
          {(status === 'ready' || status === 'disconnected' || status === 'error') && (
            <motion.div key="ready" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full max-w-sm text-center">
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
                  <p className="text-[#555555] text-xs mt-3">سيبدأ التشغيل تلقائياً عندما يشغل المسؤول أغنية</p>
                )}
              </div>

              {/* Progress (read-only) */}
              {currentSong && (
                <div className="mb-6 px-4">
                  <div className="flex items-center justify-between text-[10px] text-[#A0A0A0] mb-1">
                    <span>{fmtDuration(currentTime)}</span>
                    <span>{fmtDuration(duration)}</span>
                  </div>
                  <div className="h-1 bg-[#333333] rounded-full overflow-hidden">
                    <motion.div className="h-full bg-[#FF00FF] rounded-full" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              )}

              {/* Volume only */}
              <div className="flex items-center gap-3 justify-center mb-6 max-w-[200px] mx-auto">
                <span className="text-[#A0A0A0]">{volIcon}</span>
                <input type="range" min={0} max={1} step={0.01} value={volume}
                  onChange={e => setVolume(Number(e.target.value))}
                  className="flex-1 h-1 bg-[#333333] rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#FF00FF]"
                  style={{ background: `linear-gradient(to left, #FF00FF ${volume * 100}%, #333333 ${volume * 100}%)` }} />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-center gap-3">
                {status === 'disconnected' || status === 'error' ? (
                  <button onClick={reconnect} className="flex items-center gap-2 text-[#FFAA00] text-sm hover:bg-[#FFAA00]/10 px-4 py-2 rounded-lg transition-colors">
                    <Activity className="w-4 h-4" /> إعادة الاتصال
                  </button>
                ) : null}
                <button onClick={disconnect} className="flex items-center gap-2 text-[#FF3366] text-sm hover:bg-[#FF3366]/10 px-4 py-2 rounded-lg transition-colors">
                  <Unlink className="w-4 h-4" /> قطع الاتصال
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
