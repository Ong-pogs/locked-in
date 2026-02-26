import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from './storage';
import type { YieldData, PenaltyInfo } from '@/types';

interface YieldStore extends YieldData {
  calculateYield: () => void;
  forfeit: (amount: number) => void;
  setLockedAmount: (amount: number) => void;
  getPenalty: (saverCount: number) => PenaltyInfo;
  reset: () => void;
}

const PENALTY_MAP: Record<number, number> = {
  0: 0,
  1: 10,
  2: 20,
  3: 20,
  // 4th miss = 100% (streak fully broken)
};

const DEFAULT_APY = 8.0;

const initialState: YieldData = {
  totalAccrued: 0,
  forfeited: 0,
  apy: DEFAULT_APY,
  lockedAmount: 0,
  isActive: false,
};

export const useYieldStore = create<YieldStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      calculateYield: () => {
        const state = get();
        if (!state.isActive || state.lockedAmount <= 0) return;

        // Mock: daily yield = (lockedAmount * apy%) / 365
        const dailyYield =
          (state.lockedAmount * (state.apy / 100)) / 365;
        set({ totalAccrued: state.totalAccrued + dailyYield });
      },

      forfeit: (amount) => {
        const state = get();
        set({ forfeited: state.forfeited + amount });
      },

      setLockedAmount: (amount) =>
        set({ lockedAmount: amount, isActive: amount > 0 }),

      getPenalty: (saverCount): PenaltyInfo => {
        if (saverCount >= 4) return { tier: 3, redirectPercent: 100 };
        return {
          tier: Math.min(saverCount, 3) as PenaltyInfo['tier'],
          redirectPercent: PENALTY_MAP[saverCount] ?? 0,
        };
      },

      reset: () => set(initialState),
    }),
    {
      name: 'locked-in-yield',
      storage: createJSONStorage(() => asyncStorageAdapter),
    },
  ),
);
