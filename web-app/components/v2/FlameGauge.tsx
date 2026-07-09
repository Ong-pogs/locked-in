'use client';

import { COZY_TEXT_SHADOW } from '@/components/cozy';
import type { FlameStateV2 } from '@/services/flame/deriveFlameState';

// Flame gauge: at-a-glance health of the lock's yield. CSS-only animation
// (motion guardrail: no JS timers, freezes under prefers-reduced-motion and
// Playwright's animations:'disabled').

const STATE_META: Record<
  FlameStateV2,
  { emoji: string; label: string; color: string; glow: string; dim: boolean }
> = {
  blazing: { emoji: '🔥', label: 'Blazing', color: '#FFB84D', glow: 'rgba(255,150,50,0.55)', dim: false },
  flickering: { emoji: '🔥', label: 'Flickering', color: '#E8A24A', glow: 'rgba(232,140,60,0.35)', dim: false },
  dark: { emoji: '🕯️', label: 'Dark', color: '#A9ADBF', glow: 'rgba(120,120,160,0.25)', dim: true },
  extinguished: { emoji: '💀', label: 'Extinguished', color: '#9296A8', glow: 'transparent', dim: true },
};

export function FlameGauge({ state, className = '' }: { state: FlameStateV2; className?: string }) {
  const meta = STATE_META[state];
  const animated = state === 'blazing' || state === 'flickering';
  return (
    <div
      data-testid="v2-flame-gauge"
      data-state={state}
      className={`flex flex-col items-center gap-0.5 ${className}`}
    >
      <span
        aria-hidden
        className={`text-3xl leading-none select-none ${animated ? 'v2-flame-anim' : ''}`}
        style={{
          filter: `drop-shadow(0 0 ${animated ? 10 : 4}px ${meta.glow})${meta.dim ? ' grayscale(0.7)' : ''}`,
          opacity: meta.dim ? 0.75 : 1,
        }}
      >
        {meta.emoji}
      </span>
      <span
        className="font-pixel-mono text-[10px] uppercase tracking-[1.5px]"
        style={{ color: meta.color, textShadow: COZY_TEXT_SHADOW }}
      >
        {meta.label}
      </span>
      <style jsx>{`
        .v2-flame-anim {
          animation: v2-flame-breathe 2.4s ease-in-out infinite;
        }
        @keyframes v2-flame-breathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
        @media (prefers-reduced-motion: reduce) {
          .v2-flame-anim { animation: none; }
        }
      `}</style>
    </div>
  );
}
