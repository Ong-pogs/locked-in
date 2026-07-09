'use client';

import { COZY_TEXT, COZY_TEXT_SHADOW } from '@/components/cozy';

// Shield pips: 3 slots, filled = shields banked. A burned shield renders as a
// dimmed empty slot so the loss reads instantly.

const SHIELD_CAP = 3;

export function ShieldPips({ shields, className = '' }: { shields: number; className?: string }) {
  const banked = Math.max(0, Math.min(SHIELD_CAP, Number(shields) || 0));
  return (
    <div
      data-testid="v2-shield-pips"
      data-shields={banked}
      className={`flex items-center gap-1 ${className}`}
      aria-label={`${banked} of ${SHIELD_CAP} shields`}
    >
      {Array.from({ length: SHIELD_CAP }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className="text-sm leading-none select-none"
          style={{
            opacity: i < banked ? 1 : 0.22,
            filter: i < banked ? 'none' : 'grayscale(1)',
          }}
        >
          🛡️
        </span>
      ))}
      <span
        className="font-pixel-mono text-[10px] ml-1"
        style={{ color: COZY_TEXT, opacity: 0.75, textShadow: COZY_TEXT_SHADOW }}
      >
        ×{banked}
      </span>
    </div>
  );
}
