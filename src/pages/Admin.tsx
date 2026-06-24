import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { AdminSync, verifyAdminPassword } from '@/lib/peerSync';
import {
  Play, Pause, SkipBack, SkipForward, Upload, Copy, Check, Volume2,
  Radio, Users, ArrowLeft, Music, Trash2, Wifi, Loader2, VolumeX, Lock
} from 'lucide-react';

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

// ─── IndexedDB Helpers ──────────────────────────────────

const DB_NAME = 'SyncWaveDB_v3';
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

async function dbDeleteSong(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SONGS, 'readwrite');
    const req = tx.objectStore(STORE_SONGS).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ─── Helpers ────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
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

function formatFileSize(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function generateSongId(base64Data: string): string {
  let hash = 0;
  const str = base64Data.slice(0, 1024);
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return 'song_' + Math.abs(hash).toString(36) + '_' + Date.now().toString(36);
}

function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => resolve(audio.duration || 0);
    audio.onerror = () => resolve(0);
    audio.src = URL.createObjectURL(file);
  });
}

// ─── Password Gate ──────────────────────────────────────

function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = () => {
    if (verifyAdminPassword(password)) {
      onUnlock();
      localStorage.setItem('syncwave_admin_auth', 'true');
    } else {
      setError(true);
      setTimeout(() => setError(false), 2000);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0A] text-white font-['Tajawal'] flex items-center justify-center" dir="rtl">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-sm px-6"
      >
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-[#FF00FF]/10 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-[#FF00FF]" />
          </div>
          <h1 className="text-2xl font-bold mb-2">مساحة المسؤول</h1>
          <p className="text-[#A0A0A0] text-sm">أدخل كلمة المرور للدخول</p>
        </div>
        
        <div className="space-y-3">
          <input
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(false); }}
            placeholder="كلمة المرور"
            className={`w-full bg-[#111111] border rounded-xl px-4 py-3.5 text-center text-white placeholder-[#555555] focus:outline-none font-mono text-lg ${
              error ? 'border-[#FF3366]' : 'border-[#222222] focus:border-[#FF00FF]'
            }`}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            autoFocus
          />
          {error && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[#FF3366] text-xs text-center">
              كلمة المرور غير صحيحة
            </motion.p>
          )}
          <button
            onClick={handleSubmit}
            className="w-full bg-[#FF00FF] hover:bg-[#FF00FF]/80 text-[#0A0A0A] font-bold py-3.5 rounded-xl active:scale-[0.98] transition-all"
          >
            دخول
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Main Admin Component ───────────────────────────────

export default function Admin() {
  const navigate = useNavigate();
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const syncRef = useRef<AdminSync | null>(null);

  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem('syncwave_admin_auth') === 'true';
  });

  // Core state
  const [songs, setSongs] = useState<Song[]>([]);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('syncwave_volume');
    return saved ? parseFloat(saved) : 0.8;
  });
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [copied, setCopied] = useState(false);
  const [listenerCount, setListenerCount] = useState(0);
  const [listenerIds, setListenerIds] = useState<string[]>([]);
  const [syncState, setSyncState] = useState<'init' | 'ready' | 'error'>('init');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [peerIdReady, setPeerIdReady] = useState(false);

  // ── Load songs ──
  useEffect(() => {
    loadSongs();
  }, []);

  const loadSongs = async () => {
    const list = await dbGetAllSongs();
    setSongs(list);
  };

  // ── Init AdminSync ──
  useEffect(() => {
    if (!isAuthenticated) return;
    
    const sync = new AdminSync();
    syncRef.current = sync;

    sync.onStateChange(() => {
      setSyncState(sync.state === 'ready' ? 'ready' : 'error');
      setListenerCount(sync.getListenerCount());
      setListenerIds(sync.getListenerIds());
      if (sync.peerId) setPeerIdReady(true);
    });

    sync.onNewListener((info) => {
      setListenerCount(sync.getListenerCount());
      setListenerIds(sync.getListenerIds());
      // Auto-sync songs to new listener
      dbGetAllSongs().then(allSongs => {
        sync.sendSongs(info.id, allSongs);
      });
    });

    sync.onSongRequest(() => {
      // Send all songs to requesting listener
      dbGetAllSongs().then(allSongs => {
        sync.getListenerIds().forEach(id => {
          sync.sendSongs(id, allSongs);
        });
      });
    });

    // Persist stats
    const statsInterval = setInterval(() => {
      setListenerCount(sync.getListenerCount());
      setListenerIds(sync.getListenerIds());
      if (sync.peerId) setPeerIdReady(true);
    }, 1000);

    return () => {
      clearInterval(statsInterval);
      sync.destroy();
    };
  }, [isAuthenticated]);

  // ── Audio progress ──
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      setCurrentTime(audio.currentTime);
      setDuration(audio.duration || 0);
      setProgress(audio.duration ? (audio.currentTime / audio.duration) * 100 : 0);
    };
    const onEnded = () => {
      setIsPlaying(false);
      handleNext();
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnded);
    };
  }, [currentSong]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = isMuted ? 0 : volume;
  }, [volume, isMuted]);

  useEffect(() => {
    localStorage.setItem('syncwave_volume', volume.toString());
  }, [volume]);

  // ── Play / Pause / Seek ──
  const playSong = useCallback((song: Song) => {
    const audio = audioRef.current;
    const sync = syncRef.current;
    if (!audio || !sync) return;

    if (currentSong?.id !== song.id) {
      audio.src = base64ToBlobUrl(song.fileData, song.mimeType);
      setCurrentSong(song);
    }

    audio.play().then(() => {
      setIsPlaying(true);
      sync.sendCommand('play', song.id, audio.currentTime);
    }).catch(() => {});
  }, [currentSong]);

  const pauseAudio = useCallback(() => {
    const audio = audioRef.current;
    const sync = syncRef.current;
    if (!audio || !sync || !currentSong) return;
    audio.pause();
    setIsPlaying(false);
    sync.sendCommand('pause', currentSong.id, audio.currentTime);
  }, [currentSong]);

  const togglePlay = useCallback(() => {
    if (!currentSong) return;
    if (isPlaying) pauseAudio();
    else playSong(currentSong);
  }, [currentSong, isPlaying, pauseAudio, playSong]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    const sync = syncRef.current;
    if (!audio || !sync || !currentSong || !duration) return;
    const t = (Number(e.target.value) / 100) * duration;
    audio.currentTime = t;
    setProgress(Number(e.target.value));
    sync.sendCommand('seek', currentSong.id, t);
  };

  const handlePrev = useCallback(() => {
    if (!currentSong || songs.length < 2) return;
    const idx = songs.findIndex(s => s.id === currentSong.id);
    const prev = songs[(idx - 1 + songs.length) % songs.length];
    playSong(prev);
  }, [currentSong, songs, playSong]);

  const handleNext = useCallback(() => {
    if (!currentSong || songs.length < 2) return;
    const idx = songs.findIndex(s => s.id === currentSong.id);
    const next = songs[(idx + 1) % songs.length];
    playSong(next);
  }, [currentSong, songs, playSong]);

  // ── Upload ──
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    setUploadProgress({ current: 0, total: files.length });

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('audio/')) continue;
      try {
        setUploadProgress({ current: i + 1, total: files.length });
        const base64 = await fileToBase64(file);
        const id = generateSongId(base64);
        if (songs.find(s => s.id === id)) continue;

        const duration = await getAudioDuration(file);
        const song: Song = {
          id, title: file.name.replace(/\.[^/.]+$/, ''),
          fileData: base64, mimeType: file.type || 'audio/mpeg',
          duration, size: file.size,
          createdAt: Date.now(), createdBy: 'admin',
        };
        await dbSaveSong(song);
        syncRef.current?.broadcastNewSong(song);
      } catch (err) {
        console.error('Upload error:', err);
      }
    }

    setUploadProgress(null);
    await loadSongs();
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Delete ──
  const handleDelete = async (id: string) => {
    await dbDeleteSong(id);
    if (currentSong?.id === id) {
      pauseAudio();
      setCurrentSong(null);
    }
    await loadSongs();
    setDeleteConfirm(null);
  };

  // ── Copy link ──
  const copyLink = () => {
    const pid = syncRef.current?.peerId;
    if (!pid) return;
    const link = `${window.location.origin}${window.location.pathname}#/listen?room=${pid}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ── Logout ──
  const handleLogout = () => {
    syncRef.current?.destroy();
    localStorage.removeItem('syncwave_admin_auth');
    setIsAuthenticated(false);
  };

  if (!isAuthenticated) {
    return <PasswordGate onUnlock={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0A] text-white font-['Tajawal'] pb-40" dir="rtl">
      <audio ref={audioRef} crossOrigin="anonymous" playsInline preload="auto" />

      {/* Header */}
      <div className="sticky top-0 z-50 bg-[#0A0A0A]/95 backdrop-blur-xl border-b border-[#222222]/50">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between px-4 h-14">
          <button onClick={() => navigate('/')} className="p-2 -mr-2 hover:bg-white/5 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-[#A0A0A0]" />
          </button>
          <div className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-[#FF00FF]" />
            <span className="font-bold text-sm">مساحة المسؤول</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${syncState === 'ready' ? 'bg-[#00FF66] animate-pulse' : 'bg-[#FFAA00] animate-pulse'}`} />
              <span className="text-[10px] text-[#A0A0A0]">{syncState === 'ready' ? 'جاهز' : 'جاري...'}</span>
            </div>
            <button onClick={handleLogout} className="text-[10px] text-[#FF3366] hover:bg-[#FF3366]/10 px-2 py-1 rounded transition-colors">
              خروج
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto px-4 pt-4">
        {/* Peer ID / Invite */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-gradient-to-br from-[#FF00FF]/10 to-[#111111] border border-[#FF00FF]/20 rounded-2xl p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[#A0A0A0] text-xs">رابط الاستماع للمستمعين:</p>
            {peerIdReady && (
              <span className="text-[10px] text-[#00FF66] font-mono bg-[#00FF66]/10 px-2 py-0.5 rounded">{syncRef.current?.peerId}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-[#0A0A0A] rounded-lg px-3 py-2 text-[10px] text-[#00F0FF] font-mono truncate border border-[#222222]">
              {peerIdReady
                ? `${window.location.origin}${window.location.pathname}#/listen?room=${syncRef.current?.peerId}`
                : 'جاري التهيئة...'}
            </code>
            <button onClick={copyLink} disabled={!peerIdReady} className="bg-[#FF00FF] hover:bg-[#FF00FF]/80 disabled:opacity-40 text-white p-2.5 rounded-lg transition-all flex-shrink-0">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          {copied && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[#00FF66] text-xs mt-1.5">تم نسخ الرابط!</motion.p>}
        </motion.div>

        {/* Stats */}
        <div className="flex gap-3 mb-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="flex-1 bg-[#111111] border border-[#222222] rounded-xl p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#00FF66]/10 flex items-center justify-center">
              <Users className="w-5 h-5 text-[#00FF66]" />
            </div>
            <div>
              <p className="text-lg font-bold">{listenerCount}</p>
              <p className="text-[10px] text-[#A0A0A0]">مستمع متصل</p>
            </div>
            {listenerCount > 0 && (
              <div className="mr-auto flex -space-x-1">
                {listenerIds.slice(0, 3).map((id, i) => (
                  <div key={id} className="w-6 h-6 rounded-full bg-[#FF00FF]/20 border border-[#222222] flex items-center justify-center text-[8px] font-mono" style={{marginRight: i > 0 ? '-4px' : '0'}}>
                    {id.slice(-2)}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="flex-1 bg-[#111111] border border-[#222222] rounded-xl p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#00F0FF]/10 flex items-center justify-center">
              <Music className="w-5 h-5 text-[#00F0FF]" />
            </div>
            <div>
              <p className="text-lg font-bold">{songs.length}</p>
              <p className="text-[10px] text-[#A0A0A0]">أغنية مخزنة</p>
            </div>
          </motion.div>
        </div>

        {/* Upload */}
        <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full bg-gradient-to-r from-[#00F0FF]/20 to-transparent border-2 border-dashed border-[#00F0FF]/30 rounded-2xl p-4 mb-4 flex items-center gap-3 hover:border-[#00F0FF]/60 transition-all disabled:opacity-50"
        >
          <div className="w-12 h-12 rounded-xl bg-[#00F0FF]/20 flex items-center justify-center flex-shrink-0">
            {uploading ? <Loader2 className="w-6 h-6 text-[#00F0FF] animate-spin" /> : <Upload className="w-6 h-6 text-[#00F0FF]" />}
          </div>
          <div className="text-right flex-1">
            <p className="font-bold text-sm">{uploading ? 'جاري الرفع...' : 'رفع أغنية جديدة'}</p>
            <p className="text-[#A0A0A0] text-xs">MP3, WAV, OGG — تُحفظ محلياً وتُرسل للمستمعين</p>
          </div>
          {uploadProgress && (
            <div className="text-xs text-[#00F0FF] font-mono">
              {uploadProgress.current}/{uploadProgress.total}
            </div>
          )}
        </motion.button>
        <input ref={fileInputRef} type="file" accept="audio/*" multiple onChange={handleFile} className="hidden" />

        {/* Song List */}
        <div className="mb-4">
          <h3 className="text-sm font-bold mb-3 text-[#A0A0A0]">مكتبة الأغاني</h3>
          {songs.length === 0 ? (
            <p className="text-center py-8 text-[#555555] text-sm">لا توجد أغاني. ارفع أول أغنية!</p>
          ) : (
            <div className="space-y-2">
              <AnimatePresence>
                {songs.map((song, i) => (
                  <motion.div key={song.id} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
                    className={`flex items-center gap-3 bg-[#111111] border rounded-xl p-3 cursor-pointer transition-all ${
                      currentSong?.id === song.id ? 'border-[#00F0FF]/60 bg-[#00F0FF]/5' : 'border-[#222222] hover:border-[#444444]'
                    }`}>
                    <button onClick={() => playSong(song)} className="w-10 h-10 rounded-lg bg-[#1A1A1A] flex items-center justify-center flex-shrink-0 hover:bg-[#00F0FF]/20 transition-colors">
                      {currentSong?.id === song.id && isPlaying ? <Pause className="w-4 h-4 text-[#00F0FF]" /> : <Play className="w-4 h-4 text-[#00F0FF] ml-0.5" />}
                    </button>
                    <div className="flex-1 min-w-0" onClick={() => playSong(song)}>
                      <p className="text-sm font-medium truncate">{song.title}</p>
                      <p className="text-[10px] text-[#A0A0A0]">{formatDuration(song.duration)} · {formatFileSize(song.size)}</p>
                    </div>
                    <button onClick={() => setDeleteConfirm(song.id)} className="p-2 hover:bg-[#FF3366]/10 rounded-lg transition-colors">
                      <Trash2 className="w-4 h-4 text-[#FF3366]/60" />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center px-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-[#111111] border border-[#333333] rounded-2xl p-6 max-w-sm w-full">
              <h3 className="font-bold text-lg mb-2">حذف الأغنية</h3>
              <p className="text-[#A0A0A0] text-sm mb-4">هل أنت متأكد من حذف هذه الأغنية؟ لا يمكن التراجع عن هذا الإجراء.</p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2.5 rounded-xl border border-[#444444] text-white hover:border-[#00F0FF] transition-all text-sm font-bold">إلغاء</button>
                <button onClick={() => handleDelete(deleteConfirm)} className="flex-1 py-2.5 rounded-xl bg-[#FF3366] text-white hover:bg-[#FF3366]/80 transition-all text-sm font-bold">حذف</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Player */}
      <AnimatePresence>
        {currentSong && (
          <motion.div initial={{ y: 100 }} animate={{ y: 0 }} exit={{ y: 100 }} className="fixed bottom-0 right-0 left-0 bg-[#111111]/95 backdrop-blur-xl border-t border-[#222222] z-50">
            <div className="max-w-[1200px] mx-auto px-4 py-3">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#00F0FF]/30 to-[#FF00FF]/30 flex items-center justify-center flex-shrink-0">
                  <Music className="w-5 h-5 text-white/80" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{currentSong.title}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[#A0A0A0]">{formatDuration(currentTime)} / {formatDuration(duration)}</span>
                    {listenerCount > 0 && (
                      <span className="text-[10px] text-[#00FF66] flex items-center gap-1">
                        <Wifi className="w-3 h-3" /> بث ({listenerCount})
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <input type="range" min={0} max={100} value={progress} onChange={handleSeek}
                className="w-full h-1 bg-[#333333] rounded-full appearance-none cursor-pointer mb-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#00F0FF]"
                style={{ background: `linear-gradient(to left, #00F0FF ${progress}%, #333333 ${progress}%)` }} />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-1">
                  <button onClick={() => setIsMuted(!isMuted)} className="text-[#A0A0A0] hover:text-white transition-colors">
                    {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </button>
                  <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => { setVolume(Number(e.target.value)); setIsMuted(false); }}
                    className="w-16 h-1 bg-[#333333] rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#A0A0A0]"
                    style={{ background: `linear-gradient(to left, #A0A0A0 ${volume * 100}%, #333333 ${volume * 100}%)` }} />
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={handlePrev} className="p-2 hover:bg-white/5 rounded-full transition-colors"><SkipBack className="w-5 h-5 text-[#A0A0A0]" /></button>
                  <button onClick={togglePlay} className="w-14 h-14 rounded-full bg-[#00F0FF] flex items-center justify-center active:scale-95 transition-transform">
                    {isPlaying ? <Pause className="w-6 h-6 text-[#0A0A0A]" /> : <Play className="w-6 h-6 text-[#0A0A0A] ml-0.5" />}
                  </button>
                  <button onClick={handleNext} className="p-2 hover:bg-white/5 rounded-full transition-colors"><SkipForward className="w-5 h-5 text-[#A0A0A0]" /></button>
                </div>
                <div className="flex-1" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
