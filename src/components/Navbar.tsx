import { motion } from 'framer-motion';

interface NavbarProps {
  title: string;
  status: 'connected' | 'disconnected' | 'syncing';
  statusLabel: string;
}

const statusColors = {
  connected: '#00FF66',
  disconnected: '#FF3366',
  syncing: '#FFAA00',
};

function WaveformIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M4 16C4 16 6 8 10 8C14 8 16 16 16 16C16 16 18 24 22 24C26 24 28 16 28 16"
        stroke="#00F0FF"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M4 16C4 16 6 12 10 12C14 12 16 16 16 16C16 16 18 20 22 20C26 20 28 16 28 16"
        stroke="#00F0FF"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        opacity="0.6"
      />
      <path
        d="M4 16C4 16 6 20 10 20C14 20 16 16 16 16C16 16 18 12 22 12C26 12 28 16 28 16"
        stroke="#00F0FF"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        opacity="0.3"
      />
    </svg>
  );
}

export default function Navbar({ title, status, statusLabel }: NavbarProps) {
  return (
    <header className="sticky top-0 z-50 w-full px-4 py-3 sm:px-8">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between">
        {/* Logo - right side (RTL) */}
        <div className="flex items-center gap-2">
          <WaveformIcon />
          <span className="text-[20px] font-extrabold text-white">SyncWave</span>
        </div>

        {/* Page title - center */}
        <h1 className="absolute left-1/2 hidden -translate-x-1/2 text-[16px] font-bold text-white sm:block">
          {title}
        </h1>

        {/* Connection status - left side (RTL) */}
        <div className="flex items-center gap-2">
          <motion.div
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: statusColors[status] }}
            animate={
              status === 'connected'
                ? {
                    boxShadow: [
                      '0 0 4px rgba(0,255,102,0.4)',
                      '0 0 12px rgba(0,255,102,0.6)',
                      '0 0 4px rgba(0,255,102,0.4)',
                    ],
                  }
                : {}
            }
            transition={
              status === 'connected'
                ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' }
                : {}
            }
          />
          <span className="text-[13px] text-[#A0A0A0]">{statusLabel}</span>
        </div>
      </div>
    </header>
  );
}
