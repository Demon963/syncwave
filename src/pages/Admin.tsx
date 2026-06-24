import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { AdminSync } from '@/lib/peerSync';
import {
  Play, Pause, SkipBack, SkipForward, Upload, Music, Trash2,
  Radio, Users, ArrowLeft, Wifi, Loader2, Volume2, VolumeX, Copy, Check
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

const DB_NAME = 'SyncWaveDB_v3';
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

async function getAllSongs(): Promise<Song[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveSong(song: Song): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(song);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function deleteSong(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
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

function fmtSize(b: number): string { return (b / 1024 / 1024).toFixed(1) + ' MB'; }

function genId(b64: string): string {
  let h = 0;
  const str = b64.slice(0, 1024);
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
  return 'song_' + Math.abs(h).toString(36) + '_' + Date.now().toString(36);
}

function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const a = document.createElement('audio');
    a.preload = 'metadata';
    a.onloadedmetadata = () => resolve(a.duration || 0);
    a.onerror = () => resolve(0);
    a.src = URL.createObjectURL(file);
  });
}

function genRoomCode(): string {
  return Math.floor(100 + Math.random() * 900).toString();
}

// ─── Main Admin ─────────────────────────────────────────

export default function Admin() {
  const navigate = useNavigate();
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const syncRef = useRef<AdminSync | null>(null);

  const [roomCode, setRoomCode] = useState('');
  const [songs, setSongs] = useState<Song[]>([]);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(() => { const s = localStorage.getItem('sw_vol'); return s ? parseFloat(s) : 0.8; });
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [listenerCount, setListenerCount] = useState(0);
  const [syncState, setSyncState] = useState<'connecting' | 'ready' | 'error'>('connecting');
  const [syncError, setSyncError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [copied, setCopied] = useState(false);

  // Load songs + generate room code + init sync
  useEffect(() => {
    const code = genRoomCode();
    setRoomCode(code);
    loadSongs();

    const sync = new AdminSync(code);
    syncRef.current = sync;

    sync.onStateChange(() => {
      setSyncState(sync.state === 'ready' ? 'ready' : sync.state === 'error' ? 'error' : 'connecting');
      setSyncError(sync.errorMessage);
      setListenerCount(sync.getListenerCount());
    });

    sync.onNewListener(() => {
      setListenerCount(sync.getListenerCount());
    });

    // Register ALL existing songs
    getAllSongs().then(all => {
      console.log('[Admin] Registering', all.length, 'existing songs');
      all.forEach(s => sync.addSong(s));
    });

    const iv = setInterval(() => setListenerCount(sync.getListenerCount()), 1000);
    return () => { clearInterval(iv); sync.destroy(); };
  }, []);

  const loadSongs = async () => { setSongs(await getAllSongs()); };

  // Audio
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => {
      setCurrentTime(a.currentTime);
      setDuration(a.duration || 0);
      setProgress(a.duration ? (a.currentTime / a.duration) * 100 : 0);
    };
    const onEnd = () => { setIsPlaying(false); handleNext(); };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onEnd);
    return () => { a.removeEventListener('timeupdate', onTime); a.removeEventListener('ended', onEnd); };
  }, [currentSong]);

  useEffect(() => { if (audioRef.current) audioRef.current.volume = isMuted ? 0 : volume; }, [volume, isMuted]);
  useEffect(() => { localStorage.setItem('sw_vol', volume.toString()); }, [volume]);

  const playSong = useCallback((song: Song) => {
    const a = audioRef.current, s = syncRef.current;
    if (!a || !s) return;
    if (currentSong?.id !== song.id) { a.src = base64ToBlobUrl(song.fileData, song.mimeType); setCurrentSong(song); }
    a.play().then(() => { setIsPlaying(true); s.sendCommand('play', song.id, a.currentTime); }).catch(() => {});
  }, [currentSong]);

  const pauseAudio = useCallback(() => {
    const a = audioRef.current, s = syncRef.current;
    if (!a || !s || !currentSong) return;
    a.pause(); setIsPlaying(false); s.sendCommand('pause', currentSong.id, a.currentTime);
  }, [currentSong]);

  const togglePlay = useCallback(() => { if (!currentSong) return; isPlaying ? pauseAudio() : playSong(currentSong); }, [currentSong, isPlaying, pauseAudio, playSong]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const a = audioRef.current, s = syncRef.current;
    if (!a || !s || !currentSong || !duration) return;
    const t = (Number(e.target.value) / 100) * duration;
    a.currentTime = t; setProgress(Number(e.target.value));
    s.sendCommand('seek', currentSong.id, t);
  };

  const handlePrev = useCallback(() => {
    if (!currentSong || songs.length < 2) return;
    const idx = songs.findIndex(s => s.id === currentSong.id);
    playSong(songs[(idx - 1 + songs.length) % songs.length]);
  }, [currentSong, songs, playSong]);

  const handleNext = useCallback(() => {
    if (!currentSong || songs.length < 2) return;
    const idx = songs.findIndex(s => s.id === currentSong.id);
    playSong(songs[(idx + 1) % songs.length]);
  }, [currentSong, songs, playSong]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    for (const file of files) {
      if (!file.type.startsWith('audio/')) continue;
      try {
        const b64 = await fileToBase64(file);
        const id = genId(b64);
        if (songs.find(s => s.id === id)) continue;
        const song: Song = { id, title: file.name.replace(/\.[^/.]+$/, ''), fileData: b64, mimeType: file.type || 'audio/mpeg', duration: await getAudioDuration(file), size: file.size, createdAt: Date.now() };
        await saveSong(song);
        syncRef.current?.addSong(song);
      } catch (err) { console.error(err); }
    }
    await loadSongs(); setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDelete = async (id: string) => {
    await deleteSong(id);
    if (currentSong?.id === id) { pauseAudio(); setCurrentSong(null); }
    await loadSongs(); setDeleteConfirm(null);
  };

  const copyCode = () => {
    navigator.clipboard.writeText(roomCode).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  };

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0A] text-white font-['Tajawal'] pb-40" dir="rtl">
      <audio ref={audioRef} crossOrigin="anonymous" playsInline preload="auto" />

      {/* Header */}
      <div className="sticky top-0 z-50 bg-[#0A0A0A]/95 backdrop-blur-xl border-b border-[#222222]/50">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between px-4 h-14">
          <button onClick={() => navigate('/')} className="p-2 hover:bg-white/5 rounded-lg"><ArrowLeft className="w-5 h-5 text-[#A0A0A0]" /></button>
          <div className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-[#FF00FF]" />
            <span className="font-bold text-sm">مساحة المسؤول</span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${syncState === 'ready' ? 'bg-[#00FF66] animate-pulse' : syncState === 'error' ? 'bg-[#FF3366]' : 'bg-[#FFAA00] animate-pulse'}`} />
            <span className="text-[10px] text-[#A0A0A0] font-mono">{syncState === 'ready' ? 'متصل' : syncState === 'error' ? 'خطأ' : 'جاري...'}</span>
          </div>
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto px-4 pt-4">
        {/* Room Code - BIG & PROMINENT */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-gradient-to-br from-[#FF00FF]/15 to-[#111111] border border-[#FF00FF]/30 rounded-2xl p-5 mb-4 text-center">
          <p className="text-[#A0A0A0] text-xs mb-2">رمز الغرفة — أعطِ هذا الرقم للمستمعين</p>
          <div className="flex items-center justify-center gap-3 mb-2">
            <button onClick={copyCode} className="p-2 hover:bg-white/10 rounded-lg transition-colors" title="نسخ">
              {copied ? <Check className="w-5 h-5 text-[#00FF66]" /> : <Copy className="w-5 h-5 text-[#A0A0A0]" />}
            </button>
            <span className="text-4xl font-bold font-mono tracking-wider text-[#00F0FF]">{roomCode || '...'}</span>
            <button onClick={copyCode} className="p-2 hover:bg-white/10 rounded-lg transition-colors" title="نسخ">
              {copied ? <Check className="w-5 h-5 text-[#00FF66]" /> : <Copy className="w-5 h-5 text-[#A0A0A0]" />}
            </button>
          </div>
          <p className="text-[#555555] text-[10px]">المستمع يدخل هذا الرمز للانضمام</p>
          {syncError && <p className="text-[#FF3366] text-xs mt-2">{syncError}</p>}
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
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="flex-1 bg-[#111111] border border-[#222222] rounded-xl p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#00F0FF]/10 flex items-center justify-center">
              <Music className="w-5 h-5 text-[#00F0FF]" />
            </div>
            <div>
              <p className="text-lg font-bold">{songs.length}</p>
              <p className="text-[10px] text-[#A0A0A0]">أغنية</p>
            </div>
          </motion.div>
        </div>

        {/* Upload */}
        <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
          whileTap={{ scale: 0.98 }} onClick={() => fileInputRef.current?.click()} disabled={uploading}
          className="w-full bg-gradient-to-r from-[#00F0FF]/20 to-transparent border-2 border-dashed border-[#00F0FF]/30 rounded-2xl p-4 mb-4 flex items-center gap-3 hover:border-[#00F0FF]/60 transition-all disabled:opacity-50">
          <div className="w-12 h-12 rounded-xl bg-[#00F0FF]/20 flex items-center justify-center flex-shrink-0">
            {uploading ? <Loader2 className="w-6 h-6 text-[#00F0FF] animate-spin" /> : <Upload className="w-6 h-6 text-[#00F0FF]" />}
          </div>
          <div className="text-right flex-1">
            <p className="font-bold text-sm">{uploading ? 'جاري الرفع...' : 'رفع أغنية جديدة'}</p>
            <p className="text-[#A0A0A0] text-xs">MP3, WAV, OGG — تُحفظ وتُرسل للمستمعين تلقائياً</p>
          </div>
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
                    className={`flex items-center gap-3 bg-[#111111] border rounded-xl p-3 cursor-pointer transition-all ${currentSong?.id === song.id ? 'border-[#00F0FF]/60 bg-[#00F0FF]/5' : 'border-[#222222] hover:border-[#444444]'}`}>
                    <button onClick={() => playSong(song)} className="w-10 h-10 rounded-lg bg-[#1A1A1A] flex items-center justify-center flex-shrink-0 hover:bg-[#00F0FF]/20 transition-colors">
                      {currentSong?.id === song.id && isPlaying ? <Pause className="w-4 h-4 text-[#00F0FF]" /> : <Play className="w-4 h-4 text-[#00F0FF] ml-0.5" />}
                    </button>
                    <div className="flex-1 min-w-0" onClick={() => playSong(song)}>
                      <p className="text-sm font-medium truncate">{song.title}</p>
                      <p className="text-[10px] text-[#A0A0A0]">{fmtDuration(song.duration)} · {fmtSize(song.size)}</p>
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

      {/* Delete Modal */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center px-4">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="bg-[#111111] border border-[#333333] rounded-2xl p-6 max-w-sm w-full">
              <h3 className="font-bold text-lg mb-2">حذف الأغنية</h3>
              <p className="text-[#A0A0A0] text-sm mb-4">هل أنت متأكد؟ لا يمكن التراجع.</p>
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
                    <span className="text-[10px] text-[#A0A0A0]">{fmtDuration(currentTime)} / {fmtDuration(duration)}</span>
                    {listenerCount > 0 && <span className="text-[10px] text-[#00FF66] flex items-center gap-1"><Wifi className="w-3 h-3" /> بث ({listenerCount})</span>}
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
                  <input type="range" min={0} max={1} step={0.01} value={volume} onChange={e => { setVolume(Number(e.target.value)); setIsMuted(false); }}
                    className="w-16 h-1 bg-[#333333] rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#A0A0A0]"
                    style={{ background: `linear-gradient(to left, #A0A0A0 ${volume * 100}%, #333333 ${volume * 100}%)` }} />
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={handlePrev} className="p-2 hover:bg-white/5 rounded-full"><SkipBack className="w-5 h-5 text-[#A0A0A0]" /></button>
                  <button onClick={togglePlay} className="w-14 h-14 rounded-full bg-[#00F0FF] flex items-center justify-center active:scale-95 transition-transform">
                    {isPlaying ? <Pause className="w-6 h-6 text-[#0A0A0A]" /> : <Play className="w-6 h-6 text-[#0A0A0A] ml-0.5" />}
                  </button>
                  <button onClick={handleNext} className="p-2 hover:bg-white/5 rounded-full"><SkipForward className="w-5 h-5 text-[#A0A0A0]" /></button>
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
