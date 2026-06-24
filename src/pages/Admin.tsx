import { useState, useEffect, useRef, useCallback } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Upload,
  Volume2,
  VolumeX,
  Users,
  Copy,
  Check,
  Trash2,
  Music,
  Wifi,
  Radio,
  Link,
  Headphones,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import Layout from '@/components/Layout';
import { cn } from '@/lib/utils';
import {
  fileToBase64,
  base64ToBlobUrl,
  formatDuration,
  generateSongId,
  formatFileSize,
} from '@/lib/audio';
import type { Song } from '@/lib/audio';

/* ------------------------------------------------------------------ */
/*  Easing                                                             */
/* ------------------------------------------------------------------ */
const easeOut = [0.16, 1, 0.3, 1] as [number, number, number, number];

/* ------------------------------------------------------------------ */
/*  Waveform Visualizer (isolated + memo)                              */
/* ------------------------------------------------------------------ */
const WaveformVisualizer = React.memo(function WaveformVisualizer({
  isPlaying,
}: {
  isPlaying: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const barsRef = useRef<number[]>(Array(60).fill(4));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const barCount = 60;
    const barWidth = 2;
    const gap = 2;
    const maxH = 48;

    function draw() {
      if (!canvas || !ctx) return;
      const w = canvas.getBoundingClientRect().width;
      const h = canvas.getBoundingClientRect().height;
      ctx.clearRect(0, 0, w, h);

      for (let i = 0; i < barCount; i++) {
        if (isPlaying) {
          barsRef.current[i] = 4 + Math.random() * (maxH - 4);
        } else {
          barsRef.current[i] += (4 - barsRef.current[i]) * 0.1;
        }
        const bh = barsRef.current[i];
        const x = i * (barWidth + gap) + (w - barCount * (barWidth + gap)) / 2;
        const y = (h - bh) / 2;

        ctx.fillStyle = '#00F0FF';
        ctx.shadowColor = 'rgba(0,240,255,0.3)';
        ctx.shadowBlur = 4;
        ctx.fillRect(x, y, barWidth, bh);
        ctx.shadowBlur = 0;
      }

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '60px' }}
      className="my-3"
    />
  );
});

/* Need to import React for React.memo */
import React from 'react';

/* ------------------------------------------------------------------ */
/*  Stat Item                                                          */
/* ------------------------------------------------------------------ */
function StatItem({
  icon,
  value,
  label,
  color,
}: {
  icon: React.ReactNode;
  value: string | number;
  label: string;
  color: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div style={{ color }} className="flex items-center gap-1.5">
        {icon}
        <motion.span
          key={String(value)}
          initial={{ scale: 1.3, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          className="text-2xl font-extrabold text-white"
        >
          {value}
        </motion.span>
      </div>
      <span className="text-xs text-[#A0A0A0]">{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Toast Notification                                                  */
/* ------------------------------------------------------------------ */
function Toast({ message, type, onDone }: { message: string; type: 'success' | 'error'; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <motion.div
      initial={{ opacity: 0, x: -50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -50 }}
      className={cn(
        'fixed bottom-6 left-6 z-[100] flex items-center gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg',
        type === 'success'
          ? 'border-l-4 border-l-[#00F0FF] bg-[#1A1A1A] text-white'
          : 'border-l-4 border-l-[#FF3366] bg-[#1A1A1A] text-white'
      )}
    >
      {type === 'success' ? <Check className="h-4 w-4 text-[#00F0FF]" /> : <Trash2 className="h-4 w-4 text-[#FF3366]" />}
      {message}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Admin Component                                               */
/* ------------------------------------------------------------------ */
export default function Admin() {
  /* ---------- IDs & Refs ---------- */
  const adminId = useRef('admin_' + Math.random().toString(36).slice(2, 9)).current;
  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  /* ---------- Connection State ---------- */
  const [wsConnected, setWsConnected] = useState(false);
  const [listeners, setListeners] = useState<string[]>([]);

  /* ---------- Songs State ---------- */
  const [songs, setSongs] = useState<Song[]>([]);
  const [currentSongIndex, setCurrentSongIndex] = useState<number>(-1);

  /* ---------- Player State ---------- */
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);

  /* ---------- Upload State ---------- */
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ name: string; pct: number; done: boolean; error: string } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  /* ---------- UI State ---------- */
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  /* ---------- Computed ---------- */
  const currentSong = currentSongIndex >= 0 ? songs[currentSongIndex] : null;
  const listenerCount = listeners.length;
  const songCount = songs.length;
  const inviteUrl = `${window.location.origin}${window.location.pathname}#/listen?room=${adminId}`;

  /* ---------- Fetch Songs ---------- */
  const fetchSongs = useCallback(async () => {
    try {
      const res = await fetch('/api/songs');
      if (res.ok) {
        const data: Song[] = await res.json();
        setSongs(data);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchSongs();
  }, [fetchSongs]);

  /* ---------- WebSocket Connection ---------- */
  const connectWs = useCallback(() => {
    try {
      const ws = new WebSocket(
        `ws://${window.location.host}/ws?id=${adminId}&role=admin&room=syncwave`
      );
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onclose = () => {
        setWsConnected(false);
        wsRef.current = null;
        reconnectRef.current = setTimeout(connectWs, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case 'listenerJoined': {
              setListeners((prev) =>
                prev.includes(msg.listenerId) ? prev : [...prev, msg.listenerId]
              );
              break;
            }
            case 'listenerLeft': {
              setListeners((prev) => prev.filter((id) => id !== msg.listenerId));
              break;
            }
            case 'listenerRequestSongs': {
              /* Send current songs list via WS */
              songs.forEach((song) => {
                ws.send(JSON.stringify({ type: 'newSong', song }));
              });
              break;
            }
            default:
              break;
          }
        } catch {
          /* ignore malformed */
        }
      };
    } catch {
      reconnectRef.current = setTimeout(connectWs, 3000);
    }
  }, [adminId, songs]);

  useEffect(() => {
    connectWs();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connectWs]);

  /* ---------- Send WS Command ---------- */
  const sendCmd = useCallback(
    (action: 'play' | 'pause' | 'seek' | 'track', songId: string, time: number) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'cmd',
            action,
            songId,
            time,
            adminTime: Date.now(),
          })
        );
      }
    },
    []
  );

  /* ---------- Audio Handlers ---------- */
  const loadSong = useCallback(
    (song: Song, index: number) => {
      const audio = audioRef.current;
      if (!audio) return;

      const blobUrl = base64ToBlobUrl(song.fileData, song.mimeType);
      audio.src = blobUrl;
      audio.load();
      setCurrentSongIndex(index);
      setCurrentTime(0);
      setDuration(song.duration || 0);
      setIsPlaying(true);

      /* Auto-play and broadcast */
      audio.play().catch(() => {
        /* autoplay blocked */
      });
      sendCmd('track', song.id, 0);
    },
    [sendCmd]
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !currentSong) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      sendCmd('pause', currentSong.id, audio.currentTime);
    } else {
      audio.play().catch(() => {});
      setIsPlaying(true);
      sendCmd('play', currentSong.id, audio.currentTime);
    }
  }, [isPlaying, currentSong, sendCmd]);

  const playPrev = useCallback(() => {
    if (songs.length === 0) return;
    const newIndex = currentSongIndex > 0 ? currentSongIndex - 1 : songs.length - 1;
    loadSong(songs[newIndex], newIndex);
  }, [songs, currentSongIndex, loadSong]);

  const playNext = useCallback(() => {
    if (songs.length === 0) return;
    const newIndex = currentSongIndex < songs.length - 1 ? currentSongIndex + 1 : 0;
    loadSong(songs[newIndex], newIndex);
  }, [songs, currentSongIndex, loadSong]);

  const handleSeek = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const audio = audioRef.current;
      if (!audio || !currentSong) return;
      const t = parseFloat(e.target.value);
      audio.currentTime = t;
      setCurrentTime(t);
      sendCmd('seek', currentSong.id, t);
    },
    [currentSong, sendCmd]
  );

  const handleVolume = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (audioRef.current) {
      audioRef.current.volume = v;
      setIsMuted(v === 0);
    }
  }, []);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isMuted) {
      audio.volume = volume || 0.8;
      setIsMuted(false);
    } else {
      audio.volume = 0;
      setIsMuted(true);
    }
  }, [isMuted, volume]);

  /* ---------- Audio Event Listeners ---------- */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => setCurrentTime(audio.currentTime);
    const onDur = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      if (currentSongIndex < songs.length - 1) {
        playNext();
      } else {
        setIsPlaying(false);
      }
    };

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('durationchange', onDur);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('durationchange', onDur);
      audio.removeEventListener('ended', onEnded);
    };
  }, [songs, currentSongIndex, playNext]);

  /* ---------- Upload Handlers ---------- */
  const uploadFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setIsUploading(true);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadProgress({ name: file.name, pct: 0, done: false, error: '' });

        try {
          setUploadProgress({ name: file.name, pct: 30, done: false, error: '' });
          const base64 = await fileToBase64(file);
          setUploadProgress({ name: file.name, pct: 60, done: false, error: '' });

          const id = generateSongId(base64);
          /* Estimate duration (actual duration loaded later) */
          const estimatedDuration = 180;

          const songPayload: Omit<Song, 'createdAt'> & { createdAt: number } = {
            id,
            title: file.name.replace(/\.[^/.]+$/, ''),
            fileData: base64,
            mimeType: file.type || 'audio/mpeg',
            duration: estimatedDuration,
            size: file.size,
            createdAt: Date.now(),
            createdBy: adminId,
          };

          setUploadProgress({ name: file.name, pct: 80, done: false, error: '' });

          const res = await fetch('/api/songs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(songPayload),
          });

          if (!res.ok) throw new Error('Upload failed');

          setUploadProgress({ name: file.name, pct: 100, done: true, error: '' });
          setToast({ message: `تم رفع "${file.name}" بنجاح`, type: 'success' });

          /* Refresh songs */
          const songsRes = await fetch('/api/songs');
          if (songsRes.ok) {
            const allSongs: Song[] = await songsRes.json();
            setSongs(allSongs);
            /* Broadcast to listeners */
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(
                JSON.stringify({ type: 'newSong', song: songPayload })
              );
            }
          }
        } catch {
          setUploadProgress((prev) =>
            prev ? { ...prev, error: 'فشل الرفع' } : prev
          );
          setToast({ message: `فشل رفع "${file.name}"`, type: 'error' });
        }
      }

      setIsUploading(false);
      setUploadProgress(null);
    },
    [adminId]
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      uploadFiles(e.dataTransfer.files);
    },
    [uploadFiles]
  );

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  /* ---------- Delete Song ---------- */
  const handleDelete = useCallback(
    async (songId: string) => {
      try {
        const res = await fetch(`/api/songs/${songId}`, { method: 'DELETE' });
        if (res.ok) {
          setSongs((prev) => prev.filter((s) => s.id !== songId));
          if (currentSong?.id === songId) {
            setCurrentSongIndex(-1);
            setIsPlaying(false);
            setCurrentTime(0);
            setDuration(0);
            if (audioRef.current) {
              audioRef.current.pause();
              audioRef.current.src = '';
            }
          }
          setToast({ message: 'تم حذف الأغنية بنجاح', type: 'success' });
        }
      } catch {
        setToast({ message: 'فشل حذف الأغنية', type: 'error' });
      }
      setDeleteConfirm(null);
    },
    [currentSong]
  );

  /* ---------- Copy Invite Link ---------- */
  const copyInvite = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* fallback */
    }
  }, [inviteUrl]);

  /* ---------- Derived ---------- */
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  /* ---------- Arabic plural helper ---------- */
  const listenerLabel = listenerCount === 1 ? 'مستمع' : 'مستمعون';
  const songLabel = songCount === 1 ? 'أغنية' : 'أغنيات';

  /* ========== RENDER ========== */
  return (
    <Layout>
      <audio ref={audioRef} preload="metadata" className="hidden" />

      <Navbar
        title="مساحة المسؤول"
        status={wsConnected ? 'connected' : 'disconnected'}
        statusLabel={wsConnected ? 'متصِل' : 'غير متصل'}
      />

      <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 lg:flex-row">
          {/* ===== LEFT COLUMN (65%) ===== */}
          <div className="flex flex-col gap-4 lg:w-[65%]">
            {/* --- Player Card --- */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: easeOut, delay: 0.15 }}
              className="rounded-xl border border-[#222222] bg-[#111111] p-6 sm:p-8"
            >
              {/* Now Playing Info */}
              <div className="flex flex-col items-center">
                {/* Album Art Placeholder */}
                <div className="mb-5 flex h-40 w-40 items-center justify-center rounded-xl border border-[#222222] bg-[#0A0A0A] sm:h-[200px] sm:w-[200px]">
                  {currentSong ? (
                    <Radio className="h-12 w-12 text-[#00F0FF]" />
                  ) : (
                    <Music className="h-12 w-12 text-[#333333]" />
                  )}
                </div>

                {/* Title */}
                <h2
                  className={cn(
                    'mb-1 text-center text-lg font-bold sm:text-xl',
                    currentSong ? 'text-white' : 'text-[#555555]'
                  )}
                >
                  {currentSong ? currentSong.title : 'لم يتم تحديد أغنية'}
                </h2>

                {/* Artist / Meta */}
                {currentSong && (
                  <p className="mb-3 text-center text-[13px] text-[#A0A0A0]">
                    فنان غير معروف · {currentSong.mimeType.split('/')[1]?.toUpperCase() || 'MP3'}
                  </p>
                )}

                {/* Waveform Visualizer */}
                <div className="w-full">
                  <WaveformVisualizer isPlaying={isPlaying} />
                </div>

                {/* Progress Bar */}
                <div className="flex w-full items-center gap-3">
                  <span className="font-mono text-xs text-[#A0A0A0]">
                    {formatDuration(currentTime)}
                  </span>
                  <div className="group relative flex-1">
                    <input
                      type="range"
                      min={0}
                      max={duration || 100}
                      step={0.1}
                      value={currentTime}
                      onChange={handleSeek}
                      disabled={!currentSong}
                      className={cn(
                        'w-full cursor-pointer transition-all',
                        !currentSong && 'pointer-events-none opacity-30'
                      )}
                      style={{
                        background: `linear-gradient(to right, #00F0FF ${progressPct}%, #333333 ${progressPct}%)`,
                      }}
                    />
                  </div>
                  <span className="font-mono text-xs text-[#A0A0A0]">
                    {formatDuration(duration)}
                  </span>
                </div>

                {/* Volume */}
                <div className="mt-3 flex w-full items-center justify-end gap-2">
                  <button
                    onClick={toggleMute}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-[#A0A0A0] transition-colors hover:text-[#00F0FF]"
                  >
                    {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={isMuted ? 0 : volume}
                    onChange={handleVolume}
                    className="w-[100px] cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, #00F0FF ${(isMuted ? 0 : volume) * 100}%, #333333 ${(isMuted ? 0 : volume) * 100}%)`,
                    }}
                  />
                </div>

                {/* Transport Controls */}
                <div className="mt-5 flex items-center justify-center gap-4">
                  <button
                    onClick={playPrev}
                    disabled={songs.length === 0}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-white transition-all hover:bg-white/10 hover:text-[#00F0FF] active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <SkipBack className="h-5 w-5" />
                  </button>

                  <button
                    onClick={togglePlay}
                    disabled={!currentSong}
                    className="flex h-[52px] w-[52px] items-center justify-center rounded-full border border-[#00F0FF] text-[#00F0FF] transition-all hover:bg-[#00F0FF]/10 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    {isPlaying ? (
                      <Pause className="h-7 w-7" />
                    ) : (
                      <Play className="h-7 w-7 mr-0.5" />
                    )}
                  </button>

                  <button
                    onClick={playNext}
                    disabled={songs.length === 0}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-white transition-all hover:bg-white/10 hover:text-[#00F0FF] active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <SkipForward className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </motion.div>

            {/* --- Song Library --- */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: easeOut, delay: 0.25 }}
              className="rounded-xl border border-[#222222] bg-[#111111] p-5"
            >
              {/* Library Header */}
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">مكتبة الأغاني</h3>
                <span className="rounded-xl bg-[#1A1A1A] px-2.5 py-0.5 text-xs text-[#A0A0A0]">
                  {songCount} {songLabel}
                </span>
              </div>

              {/* Song List */}
              <div className="max-h-[400px] overflow-y-auto pr-1 sm:max-h-[400px]">
                {songs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Music className="mb-3 h-10 w-10 text-[#333333]" />
                    <p className="text-sm text-[#555555]">
                      لا توجد أغاني. ارفع ملفاتك الصوتية للبدء.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <AnimatePresence>
                      {songs.map((song, idx) => {
                        const isPlayingThis = currentSong?.id === song.id;
                        return (
                          <motion.div
                            key={song.id}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{
                              duration: 0.3,
                              delay: idx * 0.05,
                              ease: easeOut,
                            }}
                            onClick={() => loadSong(song, idx)}
                            className={cn(
                              'group flex cursor-pointer items-center gap-3 rounded-lg px-4 py-3 transition-all',
                              isPlayingThis
                                ? 'border-l-[3px] border-l-[#00F0FF] bg-[rgba(0,240,255,0.05)]'
                                : 'border-l-[3px] border-l-transparent hover:bg-[#1A1A1A]'
                            )}
                          >
                            {/* Play indicator */}
                            <div className="flex h-5 w-5 items-center justify-center">
                              {isPlayingThis && isPlaying ? (
                                <Wifi className="h-3.5 w-3.5 text-[#00F0FF]" />
                              ) : (
                                <Music
                                  className={cn(
                                    'h-3.5 w-3.5',
                                    isPlayingThis ? 'text-[#00F0FF]' : 'text-transparent group-hover:text-[#555555]'
                                  )}
                                />
                              )}
                            </div>

                            {/* Track number */}
                            <span className="w-6 font-mono text-[13px] text-[#555555]">
                              {idx + 1}.
                            </span>

                            {/* Title */}
                            <span
                              className={cn(
                                'flex-1 truncate text-sm font-medium',
                                isPlayingThis ? 'text-[#00F0FF]' : 'text-white'
                              )}
                            >
                              {song.title}
                            </span>

                            {/* Duration */}
                            <span className="font-mono text-xs text-[#666666]">
                              {formatDuration(song.duration)}
                            </span>

                            {/* Size */}
                            <span className="hidden font-mono text-xs text-[#444444] sm:block">
                              {formatFileSize(song.size)}
                            </span>

                            {/* Delete */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteConfirm(song.id);
                              }}
                              className="flex h-7 w-7 items-center justify-center rounded-full text-[#444444] opacity-0 transition-all hover:text-[#FF3366] group-hover:opacity-100"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            </motion.div>
          </div>

          {/* ===== RIGHT COLUMN (35%) ===== */}
          <div className="flex flex-col gap-4 lg:w-[35%]">
            {/* --- Upload Area --- */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, ease: easeOut, delay: 0.1 }}
              className="rounded-xl border border-[#222222] bg-[#111111] p-5"
            >
              <div className="mb-4 flex items-center gap-2">
                <Upload className="h-[18px] w-[18px] text-[#00F0FF]" />
                <h3 className="text-lg font-bold text-white">رفع ملفات صوتية</h3>
              </div>

              {/* Drop Zone */}
              <div
                onClick={() => !isUploading && fileInputRef.current?.click()}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                className={cn(isUploading && 'pointer-events-none opacity-50',
                  'flex h-40 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-all',
                  isDragOver
                    ? 'border-[#00F0FF] bg-[rgba(0,240,255,0.06)]'
                    : 'border-[#333333] bg-[rgba(0,240,255,0.02)] hover:border-[#00F0FF] hover:bg-[rgba(0,240,255,0.04)]'
                )}
              >
                <Upload
                  className={cn(
                    'mb-2 h-9 w-9 transition-colors',
                    isDragOver ? 'text-[#00F0FF]' : 'text-[#555555]'
                  )}
                />
                <p className="text-sm text-[#777777]">
                  اسحب الملفات هنا أو انقر للاختيار
                </p>
                <p className="mt-1 text-xs text-[#555555]">
                  MP3, WAV, OGG — حتى 20MB
                </p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                multiple
                className="hidden"
                onChange={(e) => uploadFiles(e.target.files)}
              />

              {/* Format Tags */}
              <div className="mt-3 flex gap-1.5">
                {['MP3', 'WAV', 'OGG'].map((fmt) => (
                  <span
                    key={fmt}
                    className="rounded border border-[#333333] px-2 py-0.5 text-[11px] font-medium text-[#666666]"
                  >
                    {fmt}
                  </span>
                ))}
              </div>

              {/* Upload Progress */}
              <AnimatePresence>
                {uploadProgress && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-3"
                  >
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-[#A0A0A0]">{uploadProgress.name}</span>
                      <span className={cn(
                        uploadProgress.error
                          ? 'text-[#FF3366]'
                          : uploadProgress.done
                            ? 'text-[#00FF66]'
                            : 'text-[#A0A0A0]'
                      )}>
                        {uploadProgress.error
                          ? uploadProgress.error
                          : uploadProgress.done
                            ? 'تم الرفع بنجاح'
                            : `${uploadProgress.pct}%`}
                      </span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-[#222222]">
                      <motion.div
                        className={cn(
                          'h-full rounded-full',
                          uploadProgress.error
                            ? 'bg-[#FF3366]'
                            : uploadProgress.done
                              ? 'bg-[#00FF66]'
                              : 'bg-[#00F0FF]'
                        )}
                        initial={{ width: 0 }}
                        animate={{ width: `${uploadProgress.pct}%` }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            {/* --- Stats Bar --- */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, ease: easeOut, delay: 0.18 }}
              className="rounded-xl border border-[#222222] bg-[#111111] px-5 py-4"
            >
              <div className="flex items-center justify-around gap-4">
                <StatItem
                  icon={<Users className="h-[18px] w-[18px]" />}
                  value={listenerCount}
                  label={listenerLabel}
                  color="#FF00FF"
                />
                <div className="h-8 w-px bg-[#222222]" />
                <StatItem
                  icon={<Music className="h-[18px] w-[18px]" />}
                  value={songCount}
                  label={songLabel}
                  color="#00F0FF"
                />
                <div className="h-8 w-px bg-[#222222]" />
                <div className="flex flex-col items-center gap-1">
                  <div className="flex items-center gap-1.5 text-[#00FF66]">
                    <Link className="h-[18px] w-[18px]" />
                    <span className="font-mono text-base font-medium text-[#00FF66]">
                      {adminId.slice(0, 8).toUpperCase()}
                    </span>
                  </div>
                  <span className="text-xs text-[#A0A0A0]">معرف البث</span>
                </div>
              </div>
            </motion.div>

            {/* --- Invite Section --- */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, ease: easeOut, delay: 0.26 }}
              className="rounded-xl border border-[#222222] bg-[#111111] px-5 py-4"
            >
              <h3 className="mb-3 text-base font-bold text-white">دعوة مستمعين</h3>

              {/* Invite Link */}
              <div className="flex items-center gap-2 rounded-lg border border-[#333333] bg-[#0A0A0A] px-3.5 py-2.5">
                <span className="flex-1 truncate font-mono text-xs text-[#A0A0A0]">
                  {inviteUrl}
                </span>
                <button
                  onClick={copyInvite}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#A0A0A0] transition-colors hover:text-[#00F0FF]"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-[#00FF66]" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            </motion.div>

            {/* --- Listeners List --- */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, ease: easeOut, delay: 0.34 }}
              className="rounded-xl border border-[#222222] bg-[#111111] p-5"
            >
              <div className="mb-3 flex items-center gap-2">
                <Headphones className="h-[18px] w-[18px] text-[#FF00FF]" />
                <h3 className="text-base font-bold text-white">المستمعون المتصلون</h3>
                {listenerCount > 0 && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#FF00FF] text-[10px] font-bold text-[#0A0A0A]">
                    {listenerCount}
                  </span>
                )}
              </div>

              {listenerCount === 0 ? (
                <p className="py-4 text-center text-sm text-[#555555]">
                  لا يوجد مستمعون متصلون حالياً
                </p>
              ) : (
                <div className="flex flex-col gap-1.5 max-h-[200px] overflow-y-auto">
                  {listeners.map((lid) => (
                    <motion.div
                      key={lid}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-center gap-2 rounded-lg bg-[#0A0A0A] px-3 py-2"
                    >
                      <div className="h-2 w-2 rounded-full bg-[#00FF66]" />
                      <span className="font-mono text-xs text-[#A0A0A0]">
                        {lid.slice(0, 16)}...
                      </span>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          </div>
        </div>
      </div>

      {/* ========== Delete Confirmation Modal ========== */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
            style={{ backgroundColor: 'rgba(10,10,10,0.85)', backdropFilter: 'blur(8px)' }}
            onClick={() => setDeleteConfirm(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[400px] rounded-2xl border border-[#333333] bg-[#111111] p-8"
            >
              <h3 className="mb-2 text-lg font-bold text-white">تأكيد الحذف</h3>
              <p className="mb-6 text-sm text-[#A0A0A0]">
                هل أنت متأكد من حذف هذه الأغنية؟ لا يمكن التراجع عن هذا الإجراء.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 rounded-lg border border-[#444444] py-2.5 text-sm font-medium text-white transition-colors hover:border-[#00F0FF] hover:text-[#00F0FF]"
                >
                  إلغاء
                </button>
                <button
                  onClick={() => handleDelete(deleteConfirm)}
                  className="flex-1 rounded-lg bg-[#FF3366] py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#FF5588]"
                >
                  حذف
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ========== Toast ========== */}
      <AnimatePresence>
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onDone={() => setToast(null)}
          />
        )}
      </AnimatePresence>
    </Layout>
  );
}
