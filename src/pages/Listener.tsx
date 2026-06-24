import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Headphones,
  Unlink,
  Volume2,
  Volume1,
  VolumeX,
  Wifi,
  Loader2,
  Music,
  LogOut,
  Play,
  Pause,
  SkipForward,
  SkipBack,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import Layout from '@/components/Layout';
import AudioVisualizer from '@/components/AudioVisualizer';
import {
  getAllSongs,
  saveSong,
  getSong,
  base64ToBlobUrl,
  formatDuration,
} from '@/lib/db';
import type { Song } from '@/lib/db';

type ConnectionState = 'form' | 'connecting' | 'syncing' | 'connected' | 'error';
type SyncStatus = 'synced' | 'syncing' | 'disconnected';

const easeOut = [0.16, 1, 0.3, 1] as [number, number, number, number];

/* ------------------------------------------------------------------ */
/*  RadioTowerIcon — animated SVG icon                                 */
/* ------------------------------------------------------------------ */
function RadioTowerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="64"
      height="64"
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <motion.path
        d="M32 8V56"
        stroke="#FF00FF"
        strokeWidth="2"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1, repeat: Infinity, repeatType: 'reverse' }}
      />
      <motion.path
        d="M20 20C20 20 24 12 32 12C40 12 44 20 44 20"
        stroke="#FF00FF"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        initial={{ opacity: 0.2 }}
        animate={{ opacity: [0.2, 1, 0.2] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.path
        d="M14 14C14 14 20 4 32 4C44 4 50 14 50 14"
        stroke="#FF00FF"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        initial={{ opacity: 0.1 }}
        animate={{ opacity: [0.1, 0.8, 0.1] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut', delay: 0.2 }}
      />
      <motion.path
        d="M26 26C26 26 28 22 32 22C36 22 38 26 38 26"
        stroke="#FF00FF"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        initial={{ opacity: 0.3 }}
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut', delay: 0.4 }}
      />
      <circle cx="32" cy="32" r="4" fill="#FF00FF" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  MiniEqIcon — tiny 3-bar equalizer for the playlist                 */
/* ------------------------------------------------------------------ */
const MiniEqIcon = React.memo(function MiniEqIcon() {
  return (
    <div className="flex items-end gap-[2px] h-[12px] w-[12px]">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-[2px] rounded-full bg-[#FF00FF]"
          animate={{ height: ['4px', '12px', '4px', '8px', '4px'] }}
          transition={{
            duration: 0.8,
            repeat: Infinity,
            delay: i * 0.15,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
});

/* React import needed for React.memo above */
import React from 'react';

/* ------------------------------------------------------------------ */
/*  getSyncedTime                                                      */
/* ------------------------------------------------------------------ */
function getSyncedTime(cmd: { time: number; timestamp: number }): number {
  const networkDelay = (Date.now() - cmd.timestamp) / 1000;
  return Math.max(0, cmd.time + networkDelay * 0.5);
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */
export default function Listener() {
  /* -- URL query param -- */
  const [searchParams] = useSearchParams();
  const roomFromUrl = searchParams.get('room');

  /* -- Connection state -- */
  const [connState, setConnState] = useState<ConnectionState>('form');
  const [adminId, setAdminId] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [latency, setLatency] = useState<number | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('disconnected');

  /* -- Audio / playback state -- */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [songCount, setSongCount] = useState(0);
  const [songs, setSongs] = useState<Song[]>([]);

  /* -- Loading state -- */
  const [downloadedCount, setDownloadedCount] = useState(0);
  const [totalToDownload, setTotalToDownload] = useState(0);

  /* -- WebSocket ref -- */
  const wsRef = useRef<WebSocket | null>(null);
  const listenerIdRef = useRef('');
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const currentBlobUrlRef = useRef<string | null>(null);
  const pendingAutoConnect = useRef(false);

  /* ---------------------------------------------------------------- */
  /*  Auto-fill from URL                                               */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    if (roomFromUrl) {
      setInputValue(roomFromUrl);
      pendingAutoConnect.current = true;
    }
  }, [roomFromUrl]);

  useEffect(() => {
    if (pendingAutoConnect.current && inputValue && connState === 'form') {
      pendingAutoConnect.current = false;
      const t = setTimeout(() => handleConnect(inputValue), 500);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue, connState]);

  /* ---------------------------------------------------------------- */
  /*  Audio element setup                                              */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audioRef.current = audio;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.pause();
      audio.src = '';
    };
  }, []);

  /* Sync volume */
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  /* ---------------------------------------------------------------- */
  /*  IndexedDB: load cached song count                                */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    getAllSongs()
      .then((cached) => {
        setSongCount(cached.length);
        setSongs(cached);
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Fetch all songs & cache to IndexedDB                             */
  /* ---------------------------------------------------------------- */
  const fetchAndCacheSongs = useCallback(async () => {
    setConnState('syncing');
    try {
      const res = await fetch('/api/songs');
      if (!res.ok) throw new Error('Failed to fetch songs');
      const serverSongs: Song[] = await res.json();

      setTotalToDownload(serverSongs.length);
      setDownloadedCount(0);

      const cached = await getAllSongs();
      const cachedIds = new Set(cached.map((s) => s.id));

      for (let i = 0; i < serverSongs.length; i++) {
        const song = serverSongs[i];
        if (!cachedIds.has(song.id)) {
          await saveSong(song);
        }
        setDownloadedCount(i + 1);
      }

      const allCached = await getAllSongs();
      setSongCount(allCached.length);
      setSongs(allCached);

      setConnState('connected');
      setSyncStatus('synced');
    } catch {
      setConnState('error');
      setErrorMsg('فشل تحميل الأغاني. حاول مرة أخرى.');
    }
  }, []);

  /* ---------------------------------------------------------------- */
  /*  WebSocket: connect                                               */
  /* ---------------------------------------------------------------- */
  const connectWebSocket = useCallback(
    (room: string) => {
      if (wsRef.current) {
        wsRef.current.close();
      }

      const listenerId = 'listener_' + Math.random().toString(36).slice(2, 9);
      listenerIdRef.current = listenerId;
      const host = window.location.host;
      const wsUrl = `ws://${host}/ws?id=${listenerId}&role=listener&room=${room}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        /* Request songs list from server */
        ws.send(JSON.stringify({ type: 'requestSongs' }));
        /* Start ping/pong for latency */
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
          }
        }, 5000);
      };

      ws.onmessage = (event) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        const msgType = msg.type as string;

        if (msgType === 'welcome') {
          setConnState((prev) => (prev === 'connecting' ? 'connecting' : prev));
        }

        if (msgType === 'pong') {
          const serverT = msg.serverT as number;
          const clientT = msg.t as number;
          if (serverT && clientT) {
            const roundTrip = Date.now() - clientT;
            setLatency(Math.round(roundTrip / 2));
          }
        }

        if (msgType === 'newSong') {
          const newSong = msg.song as Song;
          if (newSong) {
            saveSong(newSong)
              .then(() =>
                getAllSongs().then((all) => {
                  setSongs(all);
                  setSongCount(all.length);
                })
              )
              .catch(() => {
                /* ignore */
              });
          }
        }

        if (msgType === 'cmd') {
          const action = msg.action as string;
          const cmdSongId = msg.songId as string;
          const cmdTime = msg.time as number;
          const cmdTimestamp = msg.timestamp as number;

          setSyncStatus('syncing');
          setTimeout(() => setSyncStatus('synced'), 300);

          if (action === 'play') {
            handlePlayCmd(cmdSongId, cmdTime, cmdTimestamp);
          } else if (action === 'pause') {
            handlePauseCmd(cmdTime, cmdTimestamp);
          } else if (action === 'seek') {
            handleSeekCmd(cmdTime, cmdTimestamp);
          } else if (action === 'track') {
            handleTrackCmd(cmdSongId, cmdTime, cmdTimestamp);
          }
        }
      };

      ws.onerror = () => {
        setConnState('error');
        setErrorMsg('فشل الاتصال بالبث. تأكد من معرف البث.');
        setSyncStatus('disconnected');
      };

      ws.onclose = () => {
        setSyncStatus('disconnected');
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
        /* Auto-retry if currently connected */
        if (connState === 'connected' || connState === 'syncing') {
          const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 30000);
          reconnectAttemptsRef.current += 1;
          reconnectTimeoutRef.current = setTimeout(() => {
            connectWebSocket(room);
          }, delay);
        }
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connState]
  );

  /* ---------------------------------------------------------------- */
  /*  Command handlers                                                 */
  /* ---------------------------------------------------------------- */
  const loadAndPlaySong = useCallback(
    async (songId: string, playTime: number, timestamp: number) => {
      let song = await getSong(songId);

      if (!song) {
        try {
          const res = await fetch(`/api/songs/${songId}`);
          if (res.ok) {
            song = (await res.json()) as Song;
            if (song) await saveSong(song);
          }
        } catch {
          /* ignore fetch error */
        }
      }

      if (!song || !audioRef.current) return;

      setCurrentSong(song);

      /* Create blob URL */
      if (currentBlobUrlRef.current) {
        URL.revokeObjectURL(currentBlobUrlRef.current);
      }
      const blobUrl = base64ToBlobUrl(song.fileData, song.mimeType);
      currentBlobUrlRef.current = blobUrl;

      const audio = audioRef.current;
      audio.src = blobUrl;

      const syncedTime = getSyncedTime({ time: playTime, timestamp });

      try {
        await audio.play();
        audio.currentTime = syncedTime;
        setIsPlaying(true);
      } catch {
        /* autoplay blocked */
        setIsPlaying(false);
      }
    },
    []
  );

  const handlePlayCmd = useCallback(
    (songId: string, time: number, timestamp: number) => {
      loadAndPlaySong(songId, time, timestamp);
    },
    [loadAndPlaySong]
  );

  const handlePauseCmd = useCallback(
    (_time: number, _timestamp: number) => {
      if (audioRef.current) {
        audioRef.current.pause();
        setIsPlaying(false);
      }
    },
    []
  );

  const handleSeekCmd = useCallback(
    (time: number, timestamp: number) => {
      if (audioRef.current) {
        const syncedTime = getSyncedTime({ time, timestamp });
        audioRef.current.currentTime = syncedTime;
      }
    },
    []
  );

  const handleTrackCmd = useCallback(
    (songId: string, time: number, timestamp: number) => {
      loadAndPlaySong(songId, time, timestamp);
    },
    [loadAndPlaySong]
  );

  /* ---------------------------------------------------------------- */
  /*  UI handlers                                                      */
  /* ---------------------------------------------------------------- */
  const handleConnect = useCallback(
    async (id: string) => {
      if (!id.trim()) return;
      setErrorMsg('');
      setConnState('connecting');
      setAdminId(id.trim());

      connectWebSocket(id.trim());

      /* Fetch and cache songs */
      await fetchAndCacheSongs();
    },
    [connectWebSocket, fetchAndCacheSongs]
  );

  const handleDisconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    if (currentBlobUrlRef.current) {
      URL.revokeObjectURL(currentBlobUrlRef.current);
      currentBlobUrlRef.current = null;
    }
    setCurrentSong(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setConnState('form');
    setSyncStatus('disconnected');
    setAdminId('');
    setInputValue('');
    setLatency(null);
  }, []);

  /* Cleanup on unmount */
  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (currentBlobUrlRef.current) URL.revokeObjectURL(currentBlobUrlRef.current);
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Derived UI values                                                */
  /* ---------------------------------------------------------------- */
  const progressPercent = useMemo(() => {
    if (!duration || duration <= 0) return 0;
    return Math.min((currentTime / duration) * 100, 100);
  }, [currentTime, duration]);

  const navbarStatus = useMemo(() => {
    if (connState === 'connected') return { status: 'connected' as const, label: 'متصل' };
    if (connState === 'connecting' || connState === 'syncing')
      return { status: 'syncing' as const, label: 'جاري الاتصال...' };
    return { status: 'disconnected' as const, label: 'غير متصل' };
  }, [connState]);

  const connDotColor =
    syncStatus === 'synced'
      ? '#00FF66'
      : syncStatus === 'syncing'
        ? '#FFAA00'
        : '#FF3366';

  const connLabel =
    syncStatus === 'synced'
      ? 'متزامن'
      : syncStatus === 'syncing'
        ? 'جاري المزامنة...'
        : 'انقطع الاتصال';

  /* ---------------------------------------------------------------- */
  /*  Volume icon                                                      */
  /* ---------------------------------------------------------------- */
  const VolumeIcon = useMemo(() => {
    if (volume === 0) return VolumeX;
    if (volume < 0.5) return Volume1;
    return Volume2;
  }, [volume]);

  /* ================================================================== */
  /*  RENDER                                                           */
  /* ================================================================== */
  return (
    <Layout>
      <Navbar
        title="مساحة المستمع"
        status={navbarStatus.status}
        statusLabel={navbarStatus.label}
      />

      {/* ════════════════ Connection Overlay ════════════════ */}
      <AnimatePresence>
        {connState === 'form' || connState === 'connecting' || connState === 'error' ? (
          <motion.div
            key="overlay"
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0A0A0A] px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.4 } }}
          >
            {/* Logo */}
            <motion.div
              className="mb-12 flex items-center gap-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              <svg width="40" height="40" viewBox="0 0 32 32" fill="none">
                <path
                  d="M4 16C4 16 6 8 10 8C14 8 16 16 16 16C16 16 18 24 22 24C26 24 28 16 28 16"
                  stroke="#FF00FF"
                  strokeWidth="2"
                  strokeLinecap="round"
                  fill="none"
                />
                <path
                  d="M4 16C4 16 6 12 10 12C14 12 16 16 16 16C16 16 18 20 22 20C26 20 28 16 28 16"
                  stroke="#FF00FF"
                  strokeWidth="2"
                  strokeLinecap="round"
                  fill="none"
                  opacity="0.6"
                />
              </svg>
              <span className="text-[24px] font-extrabold text-white">SyncWave</span>
            </motion.div>

            {/* Radio tower icon */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, ease: easeOut }}
            >
              <RadioTowerIcon />
            </motion.div>

            {/* Title */}
            <motion.h2
              className="mt-8 text-[28px] font-bold text-white"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1, ease: easeOut }}
            >
              أدخل معرف البث
            </motion.h2>

            {/* Description */}
            <motion.p
              className="mt-2 max-w-[360px] text-center text-[14px] text-[#A0A0A0]"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.15, ease: easeOut }}
            >
              أدخل المعرف الذي شاركه المسؤول للانضمام إلى البث المتزامن.
            </motion.p>

            {/* Input */}
            <motion.div
              className="mt-8 w-full max-w-[360px]"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2, ease: easeOut }}
            >
              <input
                type="text"
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  if (errorMsg) setErrorMsg('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && inputValue.trim()) {
                    handleConnect(inputValue);
                  }
                }}
                placeholder="أدخل معرف البث"
                disabled={connState === 'connecting'}
                autoFocus
                className="w-full rounded-[12px] border bg-[#111111] px-5 py-4 text-center font-mono text-[18px] tracking-wider text-white transition-all placeholder:text-[#444444] focus:border-[#FF00FF] focus:shadow-[0_0_16px_rgba(255,0,255,0.15)] focus:outline-none disabled:opacity-50"
                style={{
                  borderColor: errorMsg ? '#FF3366' : '#333333',
                }}
              />

              {/* Error message */}
              <AnimatePresence>
                {errorMsg && (
                  <motion.p
                    className="mt-2 text-center text-[13px] text-[#FF3366]"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                  >
                    {errorMsg}
                  </motion.p>
                )}
              </AnimatePresence>
            </motion.div>

            {/* Connect button */}
            <motion.button
              className="mt-4 flex w-full max-w-[360px] items-center justify-center gap-2 rounded-[12px] py-4 text-[16px] font-bold text-[#0A0A0A] transition-all active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
              style={{ backgroundColor: '#FF00FF' }}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.25, ease: easeOut }}
              onClick={() => handleConnect(inputValue)}
              disabled={!inputValue.trim() || connState === 'connecting'}
              whileHover={{
                backgroundColor: '#FF33FF',
                boxShadow: '0 0 24px rgba(255,0,255,0.3)',
              }}
            >
              {connState === 'connecting' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  جاري الاتصال...
                </>
              ) : (
                <>
                  <Wifi className="h-4 w-4" />
                  اتصال بالبث
                </>
              )}
            </motion.button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* ════════════════ Main UI (connected / syncing) ════════════════ */}
      <AnimatePresence>
        {(connState === 'connected' || connState === 'syncing') && (
          <motion.main
            key="main"
            className="mx-auto flex max-w-[800px] flex-col gap-5 px-4 pb-12 pt-6 sm:px-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            {/* ─── Status Bar ─── */}
            <motion.div
              className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[#222222] bg-[#111111] px-5 py-3.5"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: easeOut }}
            >
              {/* Connection pill */}
              <div className="flex items-center gap-2">
                <motion.div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: connDotColor }}
                  animate={
                    syncStatus !== 'disconnected'
                      ? {
                          boxShadow: [
                            `0 0 4px ${connDotColor}40`,
                            `0 0 12px ${connDotColor}80`,
                            `0 0 4px ${connDotColor}40`,
                          ],
                        }
                      : {}
                  }
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                />
                <span className="text-[13px] font-medium text-white">{connLabel}</span>
              </div>

              {/* Stream ID */}
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-[#A0A0A0]">معرف البث:</span>
                <span className="font-mono text-[13px] font-medium text-[#FF00FF]">
                  {adminId}
                </span>
              </div>

              {/* Latency */}
              {latency !== null && (
                <div className="flex items-center gap-1">
                  <span className="text-[12px] text-[#666666]">التأخير:</span>
                  <span
                    className="font-mono text-[12px]"
                    style={{ color: latency < 100 ? '#00FF66' : '#A0A0A0' }}
                  >
                    {latency}ms
                  </span>
                </div>
              )}

              {/* Disconnect */}
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-1 text-[#666666] transition-colors hover:text-[#FF3366]"
                title="قطع الاتصال"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </motion.div>

            {/* ─── Syncing overlay ─── */}
            <AnimatePresence>
              {connState === 'syncing' && (
                <motion.div
                  className="flex flex-col items-center gap-3 rounded-[12px] border border-[#222222] bg-[#111111] px-6 py-8"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                >
                  <Loader2 className="h-8 w-8 animate-spin text-[#FF00FF]" />
                  <p className="text-[16px] font-bold text-white">
                    جاري تحميل الأغاني...
                  </p>
                  <p className="text-[14px] text-[#A0A0A0]">
                    تم تحميل {downloadedCount} من {totalToDownload} أغنية
                  </p>
                  {/* Progress bar */}
                  <div className="mt-2 h-1.5 w-full max-w-[300px] overflow-hidden rounded-full bg-[#222222]">
                    <motion.div
                      className="h-full rounded-full bg-[#FF00FF]"
                      initial={{ width: 0 }}
                      animate={{
                        width:
                          totalToDownload > 0
                            ? `${(downloadedCount / totalToDownload) * 100}%`
                            : 0,
                      }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ─── Player Card ─── */}
            <motion.div
              className="flex flex-col items-center rounded-[12px] border border-[#222222] bg-[#111111] px-6 py-8 sm:px-8"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.1, ease: easeOut }}
            >
              {/* Role badge */}
              <div className="flex items-center gap-1.5 rounded-[20px] border border-[rgba(255,0,255,0.2)] bg-[rgba(255,0,255,0.08)] px-3 py-[3px]">
                <Headphones className="h-3 w-3 text-[#FF00FF]" />
                <span className="text-[11px] font-medium text-[#FF00FF]">
                  وضع الاستماع
                </span>
              </div>

              {/* Album art placeholder */}
              <div
                className="mt-4 flex items-center justify-center rounded-[12px] border border-[#222222]"
                style={{
                  width: 'clamp(140px, 40vw, 200px)',
                  height: 'clamp(140px, 40vw, 200px)',
                  boxShadow: currentSong
                    ? '0 0 30px rgba(255,0,255,0.08)'
                    : 'none',
                }}
              >
                {currentSong ? (
                  <div className="flex flex-col items-center gap-2">
                    <Music className="h-12 w-12 text-[#FF00FF] opacity-60" />
                  </div>
                ) : (
                  <Music className="h-12 w-12 text-[#333333]" />
                )}
              </div>

              {/* Song title */}
              <h3
                className="mt-5 text-center text-[20px] font-bold"
                style={{ color: currentSong ? '#FFFFFF' : '#555555' }}
              >
                {currentSong ? currentSong.title : 'في انتظار البث...'}
              </h3>

              {/* Meta */}
              {currentSong && (
                <p className="mt-1 text-center text-[13px] text-[#A0A0A0]">
                  فنان غير معروون &middot; {currentSong.mimeType?.split('/')[1]?.toUpperCase() || 'MP3'}
                </p>
              )}

              {/* Audio Visualizer */}
              <div className="mt-4 flex justify-center">
                <AudioVisualizer color="pink" isPlaying={isPlaying} />
              </div>

              {/* Progress bar (read-only) */}
              <div className="mt-5 w-full max-w-[400px]">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[12px] text-[#A0A0A0]">
                    {formatDuration(duration)}
                  </span>
                  <span className="font-mono text-[12px] text-[#A0A0A0]">
                    {formatDuration(currentTime)}
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-[#333333]">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: '#FF00FF', width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              {/* Volume Control (ONLY interactive control) */}
              <div className="mt-5 flex flex-col items-center gap-1">
                <div className="flex items-center gap-3">
                  <VolumeIcon className="h-[18px] w-[18px] text-[#A0A0A0]" />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={volume}
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    className="w-[140px] accent-[#FF00FF]"
                    style={{
                      background: `linear-gradient(to left, #FF00FF ${volume * 100}%, #333333 ${volume * 100}%)`,
                    }}
                  />
                </div>
                <span className="text-[11px] text-[#666666]">الصوت</span>
              </div>

              {/* Transport controls (display only — no interaction) */}
              <div
                className="mt-5 flex items-center gap-5"
                style={{ opacity: currentSong ? 1 : 0.3 }}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full text-white">
                  <SkipForward className="h-5 w-5" />
                </div>
                <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full border border-[#FF00FF]">
                  {isPlaying ? (
                    <Pause className="h-6 w-6 text-[#FF00FF]" />
                  ) : (
                    <Play className="h-6 w-6 text-[#FF00FF]" />
                  )}
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full text-white">
                  <SkipBack className="h-5 w-5" />
                </div>
              </div>

              {/* Sync status */}
              <div className="mt-4 flex items-center gap-1.5">
                <div
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    backgroundColor:
                      syncStatus === 'synced'
                        ? '#00FF66'
                        : syncStatus === 'syncing'
                          ? '#FFAA00'
                          : '#FF3366',
                  }}
                />
                <span
                  className="text-[12px]"
                  style={{
                    color:
                      syncStatus === 'synced'
                        ? '#00FF66'
                        : syncStatus === 'syncing'
                          ? '#FFAA00'
                          : '#FF3366',
                  }}
                >
                  {syncStatus === 'synced'
                    ? 'متزامن مع المسؤول'
                    : syncStatus === 'syncing'
                      ? 'جاري التحديث...'
                      : 'غير متزامن'}
                </span>
              </div>
            </motion.div>

            {/* ─── Playlist ─── */}
            <motion.div
              className="rounded-[12px] border border-[#222222] bg-[#111111] p-5"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.2, ease: easeOut }}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-[16px] font-bold text-white">قائمة التشغيل</h3>
                <span className="text-[12px] text-[#666666]">
                  يتحكم المسؤول في التشغيل
                </span>
              </div>

              <div className="mt-3 flex items-center gap-2 text-[12px] text-[#A0A0A0]">
                <Music className="h-3.5 w-3.5" />
                <span>{songCount} أغنية</span>
              </div>

              {/* Song list */}
              <div className="mt-3 max-h-[250px] overflow-y-auto">
                {songs.length === 0 ? (
                  <p className="py-6 text-center text-[14px] text-[#555555]">
                    لا توجد أغاني في قائمة التشغيل.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {songs.map((song, idx) => {
                      const isCurrent = currentSong?.id === song.id;
                      return (
                        <motion.div
                          key={song.id}
                          className="flex items-center gap-3 rounded-[8px] px-4 py-3 transition-colors"
                          style={{
                            borderRight:
                              isCurrent ? '3px solid #FF00FF' : '3px solid transparent',
                            backgroundColor: isCurrent
                              ? 'rgba(255,0,255,0.05)'
                              : 'transparent',
                          }}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: idx * 0.04 }}
                        >
                          {/* Track number or eq */}
                          <div className="flex w-5 items-center justify-center">
                            {isCurrent && isPlaying ? (
                              <MiniEqIcon />
                            ) : (
                              <span className="text-[12px] text-[#666666]">
                                {idx + 1}
                              </span>
                            )}
                          </div>

                          {/* Title */}
                          <span
                            className="flex-1 text-[14px] font-medium"
                            style={{ color: isCurrent ? '#FFFFFF' : '#A0A0A0' }}
                          >
                            {song.title}
                          </span>

                          {/* Duration */}
                          <span className="font-mono text-[12px] text-[#666666]">
                            {formatDuration(song.duration)}
                          </span>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>

            {/* ─── Disconnect button (bottom) ─── */}
            <motion.button
              onClick={handleDisconnect}
              className="mx-auto mt-2 flex items-center gap-2 rounded-[8px] border border-[#222222] px-6 py-3 text-[14px] text-[#666666] transition-all hover:border-[#FF3366] hover:text-[#FF3366]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              <Unlink className="h-4 w-4" />
              قطع الاتصال
            </motion.button>
          </motion.main>
        )}
      </AnimatePresence>
    </Layout>
  );
}
