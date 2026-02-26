export interface YieldData {
  /** Total yield accrued in USDC */
  totalAccrued: number;
  /** Yield forfeited due to missed streaks */
  forfeited: number;
  /** Current APY percentage */
  apy: number;
  /** Amount of USDC/USDT locked */
  lockedAmount: number;
  /** Whether yield is actively accruing (flame must be lit) */
  isActive: boolean;
}

export type PenaltyTier = 0 | 1 | 2 | 3;

export interface PenaltyInfo {
  tier: PenaltyTier;
  /** Percentage of yield redirected: 10% → 20% → 20% → 100% */
  redirectPercent: number;
}
