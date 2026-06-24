import { motion } from 'framer-motion';
import { Radio, Headphones } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useState } from 'react';

/* ───────────────────── mesh gradient background ───────────────────── */

function MeshBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* Base */}
      <div className="absolute inset-0 bg-[#0A0A0A]" />

      {/* Animated gradient overlays */}
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
        style={{
          background: `
            radial-gradient(circle at 20% 80%, rgba(0,240,255,0.06) 0%, transparent 50%),
            radial-gradient(circle at 80% 20%, rgba(255,0,255,0.06) 0%, transparent 50%),
            radial-gradient(circle at 50% 50%, rgba(0,240,255,0.03) 0%, transparent 60%)
          `,
        }}
      />

      {/* Drifting cyan orb */}
      <motion.div
        className="absolute h-[600px] w-[600px] rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(0,240,255,0.04) 0%, transparent 70%)',
        }}
        animate={{
          x: ['-10%', '30%', '-10%'],
          y: ['60%', '10%', '60%'],
        }}
        transition={{
          duration: 20,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Drifting pink orb */}
      <motion.div
        className="absolute h-[500px] w-[500px] rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(255,0,255,0.04) 0%, transparent 70%)',
        }}
        animate={{
          x: ['60%', '20%', '60%'],
          y: ['-10%', '40%', '-10%'],
        }}
        transition={{
          duration: 18,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />
    </div>
  );
}

/* ───────────────────── animated waveform logo ───────────────────── */

function AnimatedWaveformLogo() {
  return (
    <div className="flex items-center gap-2">
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* 3 animated sinusoidal curves */}
        <motion.path
          d="M4 20C4 20 8 4 16 4C24 4 28 20 28 20C28 20 32 36 40 36"
          stroke="#00F0FF"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1, delay: 0.2, ease: 'easeOut' }}
        />
        <motion.path
          d="M4 20C4 20 8 12 16 12C24 12 28 20 28 20C28 20 32 28 40 28"
          stroke="#00F0FF"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
          opacity="0.6"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.6 }}
          transition={{ duration: 1, delay: 0.35, ease: 'easeOut' }}
        />
        <motion.path
          d="M4 20C4 20 8 28 16 28C24 28 28 20 28 20C28 20 32 12 40 12"
          stroke="#00F0FF"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
          opacity="0.3"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.3 }}
          transition={{ duration: 1, delay: 0.5, ease: 'easeOut' }}
        />
      </svg>
      <motion.span
        className="text-[24px] font-extrabold text-white"
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, delay: 0.6, ease: 'easeOut' }}
      >
        SyncWave
      </motion.span>
    </div>
  );
}

/* ───────────────────── audio visualizer bars (mini) ───────────────────── */

function MiniVisualizer({ color }: { color: 'cyan' | 'pink' }) {
  const barCount = 5;
  const barColor = color === 'cyan' ? '#00F0FF' : '#FF00FF';

  return (
    <div className="flex items-end gap-[3px]" style={{ height: '20px' }}>
      {Array.from({ length: barCount }).map((_, i) => (
        <motion.div
          key={i}
          className="w-[3px] rounded-full"
          style={{ backgroundColor: barColor }}
          animate={{
            height: ['4px', `${8 + Math.random() * 12}px`, '4px'],
          }}
          transition={{
            duration: 0.6 + Math.random() * 0.4,
            repeat: Infinity,
            delay: i * 0.1,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}

/* ───────────────────── selection card ───────────────────── */

interface SelectionCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  buttonText: string;
  tag: string;
  tagColor: string;
  tagBg: string;
  borderColor: string;
  shadowColor: string;
  buttonBg: string;
  buttonHoverBg: string;
  onClick: () => void;
  delay: number;
}

function SelectionCard({
  icon,
  title,
  description,
  buttonText,
  tag,
  tagColor,
  tagBg,
  borderColor,
  shadowColor,
  buttonBg,
  buttonHoverBg,
  onClick,
  delay,
}: SelectionCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <motion.div
      className="flex-1 cursor-pointer rounded-2xl border border-[#222222] bg-[#111111] p-8 text-center transition-all duration-300 sm:p-12"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: 'easeOut' }}
      whileHover={{
        y: -4,
        borderColor,
        boxShadow: `0 0 40px ${shadowColor}, inset 0 0 40px ${shadowColor}`,
      }}
      onClick={onClick}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* Icon Container */}
      <div
        className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border sm:h-[64px] sm:w-[64px]"
        style={{
          backgroundColor: tagBg,
          borderColor: `${tagColor}33`,
        }}
      >
        {icon}
      </div>

      {/* Title */}
      <h3 className="mt-5 text-[22px] font-bold text-white">{title}</h3>

      {/* Description */}
      <p className="mx-auto mt-2 max-w-[260px] text-[14px] leading-relaxed text-[#A0A0A0]">
        {description}
      </p>

      {/* CTA Button */}
      <motion.button
        className="mt-6 w-full rounded-lg px-6 py-3 text-[14px] font-bold text-[#0A0A0A] transition-colors duration-200"
        style={{ backgroundColor: buttonBg }}
        whileHover={{ backgroundColor: buttonHoverBg }}
        whileTap={{ scale: 0.97 }}
        transition={{ duration: 0.1 }}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        {buttonText}
      </motion.button>

      {/* Tag */}
      <span
        className="mt-3 inline-block rounded px-2 py-0.5 text-[11px] font-medium"
        style={{ color: tagColor, backgroundColor: tagBg }}
      >
        {tag}
      </span>

      {/* Mini visualizer on hover */}
      <motion.div
        className="mt-4 flex justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: isHovered ? 1 : 0 }}
        transition={{ duration: 0.2 }}
      >
        <MiniVisualizer color={borderColor === '#00F0FF' ? 'cyan' : 'pink'} />
      </motion.div>
    </motion.div>
  );
}

/* ───────────────────── header ───────────────────── */

function Header() {
  return (
    <motion.header
      className="relative z-10 flex items-center justify-between px-4 py-4 sm:px-8"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: 0.05, ease: 'easeOut' }}
    >
      <AnimatedWaveformLogo />
      <span className="text-[13px] text-[#666666]">منصة البث الصوتي المتزامن</span>
    </motion.header>
  );
}

/* ───────────────────── hero section ───────────────────── */

function HeroSection() {
  return (
    <section className="relative z-10 px-4 pb-8 pt-12 text-center sm:px-8 sm:pb-12 sm:pt-16">
      <motion.h2
        className="text-[36px] font-extrabold leading-tight text-white sm:text-[48px]"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.15, ease: 'easeOut' }}
      >
        اختر مسارك
      </motion.h2>

      <motion.p
        className="mx-auto mt-4 max-w-[480px] text-[16px] leading-relaxed text-[#A0A0A0]"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.25, ease: 'easeOut' }}
      >
        انضم كمسؤول لبث صوتك مباشرةً، أو كمستمع للاستماع المتزامن مع الجميع.
      </motion.p>

      <motion.div
        className="mt-8 text-[20px] tracking-[8px] text-[#00F0FF]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.4, ease: 'easeOut' }}
      >
        ···
      </motion.div>
    </section>
  );
}

/* ───────────────────── selection cards section ───────────────────── */

function SelectionCardsSection() {
  const navigate = useNavigate();

  return (
    <section className="relative z-10 px-4 pb-16 sm:px-8">
      <div className="mx-auto flex max-w-[800px] flex-col gap-4 sm:flex-row sm:gap-6">
        <SelectionCard
          icon={<Radio size={28} color="#00F0FF" />}
          title="أنا المسؤول"
          description="ارفع أغانيك، تحكم في البث، وادعُ مستمعين للانضمام."
          buttonText="الدخول كمسؤول"
          tag="Broadcaster"
          tagColor="#00F0FF"
          tagBg="rgba(0,240,255,0.08)"
          borderColor="#00F0FF"
          shadowColor="rgba(0,240,255,0.12)"
          buttonBg="#00F0FF"
          buttonHoverBg="#33F5FF"
          onClick={() => navigate('/admin')}
          delay={0.4}
        />

        <SelectionCard
          icon={<Headphones size={28} color="#FF00FF" />}
          title="أنا مستمع"
          description="أدخل معرف البث واستمع متزامنًا مع المسؤول والمستمعين الآخرين."
          buttonText="الدخول كمستمع"
          tag="Listener"
          tagColor="#FF00FF"
          tagBg="rgba(255,0,255,0.08)"
          borderColor="#FF00FF"
          shadowColor="rgba(255,0,255,0.12)"
          buttonBg="#FF00FF"
          buttonHoverBg="#FF33FF"
          onClick={() => navigate('/listener')}
          delay={0.5}
        />
      </div>
    </section>
  );
}

/* ───────────────────── footer note ───────────────────── */

function FooterNote() {
  return (
    <motion.footer
      className="relative z-10 pb-8 text-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.7 }}
    >
      <p className="text-[12px] text-[#444444]">
        SyncWave — بث صوتي متزامن في الوقت الفعلي
      </p>
    </motion.footer>
  );
}

/* ───────────────────── home page ───────────────────── */

export default function Home() {
  return (
    <div className="relative min-h-[100dvh]">
      <MeshBackground />
      <Header />
      <HeroSection />
      <SelectionCardsSection />
      <FooterNote />
    </div>
  );
}
