import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from './storage';
import type { TokenData } from '@/types';

interface TokenStore extends TokenData {
  awardFragment: (amount: number, source: string) => boolean;
  canEarn: () => boolean;
  consolidateFragments: () => void;
  spendTokens: (amount: number) => boolean;
  reset: () => void;
}

const DAILY_CAP = 1;
const DEFAULT_WALLET_CAP = 7;

const initialState: TokenData = {
  fragments: 0,
  fullTokens: 0,
  dailyEarned: 0,
  walletCap: DEFAULT_WALLET_CAP,
};

export const useTokenStore = create<TokenStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      awardFragment: (amount, _source) => {
        const state = get();
        if (state.dailyEarned >= DAILY_CAP) return false;
        if (state.fullTokens >= state.walletCap) return false;

        const clampedAmount = Math.min(amount, DAILY_CAP - state.dailyEarned);
        const newFragments = state.fragments + clampedAmount;
        const newFull = Math.floor(newFragments);
        const remainder = newFragments - newFull;

        const totalFull = Math.min(
          state.fullTokens + newFull,
          state.walletCap,
        );

        set({
          fragments: remainder,
          fullTokens: totalFull,
          dailyEarned: state.dailyEarned + clampedAmount,
        });
        return true;
      },

      canEarn: () => {
        const state = get();
        return (
          state.dailyEarned < DAILY_CAP &&
          state.fullTokens < state.walletCap
        );
      },

      spendTokens: (amount) => {
        const state = get();
        if (state.fullTokens < amount) return false;
        set({ fullTokens: state.fullTokens - amount });
        return true;
      },

      consolidateFragments: () => {
        const state = get();
        if (state.fragments >= 1) {
          const newFull = Math.floor(state.fragments);
          set({
            fragments: state.fragments - newFull,
            fullTokens: Math.min(
              state.fullTokens + newFull,
              state.walletCap,
            ),
          });
        }
      },

      reset: () => set(initialState),
    }),
    {
      name: 'locked-in-tokens',
      storage: createJSONStorage(() => asyncStorageAdapter),
    },
  ),
);
