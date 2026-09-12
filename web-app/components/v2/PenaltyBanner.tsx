'use client';

import { COZY_TEXT_SHADOW } from '@/components/cozy';

// Penalty banner. Two things can cost a position a yield tier, and a user who
// has been hit by one must be told WHICH — a bare reduced percentage with no
// named cause is the worst thing a money surface can show.
//
//   lapseCount         missed-day lapses (one-mercy: 0 -> 100%, 1 -> 50%, 2+ -> 0%)
//   arenaPenaltyTiers  1 if a staked Clockwork Spire season settled FORFEIT on this lock
//
// The ladder here mirrors backend claimVoucher.effectiveYieldBps. That function
// is the authority — this only explains what it already decided.
const TIERS = [10_000, 5_000, 0];

function clamp(n: unknown, max: number) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.min(Math.floor(v), max);
}

/** Kept-yield bps for a combined penalty. Exported for the callers' own maths. */
export function combinedKeptBps(lapseCount: number, arenaPenaltyTiers = 0): number {
  const tier = clamp(lapseCount, 2) + clamp(arenaPenaltyTiers, 1);
  return TIERS[Math.min(tier, 2)];
}

function reasonFor(lapses: number, arena: number, forfeitPct: number): string {
  const allGone = forfeitPct >= 100;
  if (lapses > 0 && arena > 0) {
    return allGone
      ? 'A lapse and a lost Spire season — 100% of yield forfeits to the community pot. Principal stays yours.'
      : `A lapse and a lost Spire season — ${forfeitPct}% of yield forfeits to the community pot.`;
  }
  if (arena > 0) {
    return allGone
      ? 'Your staked Spire season finished behind — 100% of yield forfeits to the community pot. Principal stays yours.'
      : `Your staked Spire season finished behind — ${forfeitPct}% of yield forfeits to the community pot. Principal stays yours.`;
  }
  return allGone
    ? '2nd lapse — 100% of yield forfeits to the community pot. Principal stays yours.'
    : `1st lapse — ${forfeitPct}% of yield forfeits to the community pot. One more and it all goes.`;
}

export function PenaltyBanner({
  lapseCount,
  arenaPenaltyTiers = 0,
  forfeitUi = null,
  className = '',
}: {
  lapseCount: number;
  /** 1 if a staked Clockwork Spire season settled FORFEIT on this lock. */
  arenaPenaltyTiers?: number;
  /** Concrete USDC amount being forfeited (formatted, no $) — shown when known. */
  forfeitUi?: string | null;
  className?: string;
}) {
  const lapses = clamp(lapseCount, 2);
  const arena = clamp(arenaPenaltyTiers, 1);
  if (lapses === 0 && arena === 0) return null;

  const forfeitPct = 100 - combinedKeptBps(lapses, arena) / 100;
  const final = forfeitPct >= 100;
  const color = final ? '#FF8FA3' : '#F0A878';

  return (
    <div
      data-testid="v2-penalty-banner"
      data-lapses={lapses}
      data-arena-tiers={arena}
      role="status"
      className={`rounded-lg border px-3 py-2 ${className}`}
      style={{
        backgroundColor: final ? 'rgba(255,68,102,0.12)' : 'rgba(232,132,90,0.12)',
        borderColor: final ? 'rgba(255,68,102,0.45)' : 'rgba(232,132,90,0.45)',
      }}
    >
      <p
        className="font-pixel-mono text-[11px] leading-snug"
        style={{ color, textShadow: COZY_TEXT_SHADOW }}
      >
        {reasonFor(lapses, arena, forfeitPct)}
      </p>
      {forfeitUi && (
        <p
          data-testid="v2-penalty-forfeit-amount"
          className="font-pixel-mono text-[12px] font-bold mt-1"
          style={{ color, textShadow: COZY_TEXT_SHADOW }}
        >
          ≈ ${forfeitUi} USDC of your yield goes to the pot.
        </p>
      )}
    </div>
  );
}
