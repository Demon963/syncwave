import { useRef, useEffect, useCallback } from 'react';

interface AudioVisualizerProps {
  color: 'cyan' | 'pink';
  isPlaying?: boolean;
}

const BAR_COUNT = 30;
const BAR_WIDTH = 3;
const GAP = 4;
const MIN_HEIGHT = 4;
const MAX_HEIGHT = 48;

const colorMap = {
  cyan: '#00F0FF',
  pink: '#FF00FF',
};

export default function AudioVisualizer({ color, isPlaying = true }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barHeightsRef = useRef<number[]>(Array(BAR_COUNT).fill(MIN_HEIGHT));
  const targetHeightsRef = useRef<number[]>(Array(BAR_COUNT).fill(MIN_HEIGHT));
  const animFrameRef = useRef<number>(0);
  const lastUpdateRef = useRef<number>(0);

  const animate = useCallback(
    (timestamp: number) => {
      if (!canvasRef.current) return;
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) return;

      const canvasWidth = BAR_COUNT * (BAR_WIDTH + GAP) - GAP;
      const dpr = window.devicePixelRatio || 1;

      // Set canvas size on first run
      if (canvasRef.current.width !== canvasWidth * dpr) {
        canvasRef.current.width = canvasWidth * dpr;
        canvasRef.current.height = MAX_HEIGHT * dpr;
        ctx.scale(dpr, dpr);
      }

      // Update targets every 100ms
      if (timestamp - lastUpdateRef.current > 100) {
        lastUpdateRef.current = timestamp;
        for (let i = 0; i < BAR_COUNT; i++) {
          if (isPlaying) {
            targetHeightsRef.current[i] =
              MIN_HEIGHT + Math.random() * (MAX_HEIGHT - MIN_HEIGHT);
          } else {
            targetHeightsRef.current[i] = MIN_HEIGHT;
          }
        }
      }

      // Smooth interpolation
      for (let i = 0; i < BAR_COUNT; i++) {
        const diff = targetHeightsRef.current[i] - barHeightsRef.current[i];
        barHeightsRef.current[i] += diff * 0.2;
      }

      // Clear canvas
      ctx.clearRect(0, 0, canvasWidth, MAX_HEIGHT);

      // Draw bars
      const barColor = colorMap[color];
      for (let i = 0; i < BAR_COUNT; i++) {
        const x = i * (BAR_WIDTH + GAP);
        const height = barHeightsRef.current[i];
        const y = MAX_HEIGHT - height;

        ctx.fillStyle = barColor;
        ctx.globalAlpha = 0.6 + (height / MAX_HEIGHT) * 0.4;
        ctx.fillRect(x, y, BAR_WIDTH, height);
      }
      ctx.globalAlpha = 1;

      animFrameRef.current = requestAnimationFrame(animate);
    },
    [color, isPlaying]
  );

  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [animate]);

  const canvasWidth = BAR_COUNT * (BAR_WIDTH + GAP) - GAP;

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: `${canvasWidth}px`,
        height: `${MAX_HEIGHT}px`,
      }}
    />
  );
}
