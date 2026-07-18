'use client';

import { COZY_TEXT_SHADOW } from '@/components/cozy';
import { yieldKeptBps } from '@/services/flame/deriveFlameState';

// One-mercy penalty banner. Rendered only when lapseCount > 0 — copy states
// exactly what settlement will do, no euphemisms on a money surface.

export function PenaltyBanner({
  lapseCount,
  forfeitUi = null,
  className = '',
}: {
  lapseCount: number;
  /** Concrete USDC amount being forfeited (formatted, no $) — shown when known. */
  forfeitUi?: string | null;
  className?: string;
}) {
  const lapses = Math.max(0, Number(lapseCount) || 0);
  if (lapses === 0) return null;
  const keptPct = yieldKeptBps(lapses) / 100;
  const forfeitPct = 100 - keptPct;
  const final = lapses >= 2;
  return (
    <div
      data-testid="v2-penalty-banner"
      data-lapses={lapses}
      role="status"
      className={`rounded-lg border px-3 py-2 ${className}`}
      style={{
        backgroundColor: final ? 'rgba(255,68,102,0.12)' : 'rgba(232,132,90,0.12)',
        borderColor: final ? 'rgba(255,68,102,0.45)' : 'rgba(232,132,90,0.45)',
      }}
    >
      <p
        className="font-pixel-mono text-[11px] leading-snug"
        style={{ color: final ? '#FF8FA3' : '#F0A878', textShadow: COZY_TEXT_SHADOW }}
      >
        {final
          ? '2nd lapse — 100% of yield forfeits to the community pot. Principal stays yours.'
          : `1st lapse — ${forfeitPct}% of yield forfeits to the community pot. One more and it all goes.`}
      </p>
      {forfeitUi && (
        <p
          data-testid="v2-penalty-forfeit-amount"
          className="font-pixel-mono text-[12px] font-bold mt-1"
          style={{ color: final ? '#FF8FA3' : '#F0A878', textShadow: COZY_TEXT_SHADOW }}
        >
          ≈ ${forfeitUi} USDC of your yield goes to the pot.
        </p>
      )}
    </div>
  );
}
