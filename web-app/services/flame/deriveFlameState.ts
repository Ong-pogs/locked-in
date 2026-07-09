// v2 flame gauge state machine (spec §5 item 16 / §4.2 one-mercy tiers).
// Pure function of backend-served engine state — the client never does
// UTC-day math (completedToday/dayEndsAtUtc are server-computed).
//
//   BLAZING      lesson done today, no lapses — yield fully protected
//   FLICKERING   no lesson yet today (countdown to UTC midnight), or shields
//                already burning — at risk but not yet penalized
//   DARK         1 lapse — 50% of yield forfeits at settlement
//   EXTINGUISHED 2+ lapses — 100% of yield forfeits to the community pot

export type FlameStateV2 = 'blazing' | 'flickering' | 'dark' | 'extinguished';

export interface FlameInputs {
  shields: number;
  lapseCount: number;
  lapseOpen: boolean;
  completedToday: boolean;
}

export function deriveFlameState(inputs: FlameInputs): FlameStateV2 {
  const lapseCount = Math.max(0, Number(inputs.lapseCount) || 0);
  if (lapseCount >= 2) return 'extinguished';
  if (lapseCount === 1) return 'dark';
  if (inputs.completedToday && Number(inputs.shields) >= 3) return 'blazing';
  return 'flickering';
}

/** Yield-kept bps for the badge copy: [10000, 5000, 0][min(lapse, 2)]. */
export function yieldKeptBps(lapseCount: number): number {
  const tiers = [10_000, 5_000, 0];
  return tiers[Math.min(Math.max(0, Number(lapseCount) || 0), 2)];
}
