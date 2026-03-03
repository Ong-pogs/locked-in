import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from './storage';
import type { BrewData, BrewModeId } from '@/types';
import { BREW_MODES } from '@/types';

interface BrewStore extends BrewData {
  startBrew: (modeId: BrewModeId) => void;
  tickBrew: () => void;
  cancelBrew: () => void;
  getRemainingMs: () => number;
  getProgress: () => number;
  getCurrentIchorAccrued: () => number;
  spendIchor: (amount: number) => boolean;
  reset: () => void;
}

const initialState: BrewData = {
  status: 'IDLE',
  activeModeId: null,
  startedAt: null,
  endsAt: null,
  ichorBalance: 0,
  totalIchorProduced: 0,
  brewsCompleted: 0,
};

export const useBrewStore = create<BrewStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      startBrew: (modeId) => {
        const mode = BREW_MODES[modeId];
        if (!mode) return;
        const now = Date.now();
        set({
          status: 'BREWING',
          activeModeId: modeId,
          startedAt: new Date(now).toISOString(),
          endsAt: new Date(now + mode.durationMs).toISOString(),
        });
      },

      tickBrew: () => {
        const state = get();
        if (state.status !== 'BREWING' || !state.endsAt || !state.activeModeId) return;

        const now = Date.now();
        const endsAt = new Date(state.endsAt).getTime();

        if (now >= endsAt) {
          // Brew complete — award full ichor
          const mode = BREW_MODES[state.activeModeId];
          const totalIchor = mode.ichorPerHour * (mode.durationMs / (60 * 60 * 1000));
          set({
            status: 'IDLE',
            activeModeId: null,
            startedAt: null,
            endsAt: null,
            ichorBalance: state.ichorBalance + totalIchor,
            totalIchorProduced: state.totalIchorProduced + totalIchor,
            brewsCompleted: state.brewsCompleted + 1,
          });
        }
      },

      cancelBrew: () => {
        const state = get();
        if (state.status !== 'BREWING') return;

        // Award partial ichor for elapsed time
        const accrued = get().getCurrentIchorAccrued();
        set({
          status: 'IDLE',
          activeModeId: null,
          startedAt: null,
          endsAt: null,
          ichorBalance: state.ichorBalance + accrued,
          totalIchorProduced: state.totalIchorProduced + accrued,
        });
      },

      getRemainingMs: () => {
        const state = get();
        if (state.status !== 'BREWING' || !state.endsAt) return 0;
        return Math.max(0, new Date(state.endsAt).getTime() - Date.now());
      },

      getProgress: () => {
        const state = get();
        if (state.status !== 'BREWING' || !state.startedAt || !state.endsAt) return 0;
        const start = new Date(state.startedAt).getTime();
        const end = new Date(state.endsAt).getTime();
        const total = end - start;
        if (total <= 0) return 1;
        const elapsed = Date.now() - start;
        return Math.min(1, Math.max(0, elapsed / total));
      },

      getCurrentIchorAccrued: () => {
        const state = get();
        if (state.status !== 'BREWING' || !state.startedAt || !state.activeModeId) return 0;
        const mode = BREW_MODES[state.activeModeId];
        const elapsed = Date.now() - new Date(state.startedAt).getTime();
        const hours = Math.max(0, elapsed) / (60 * 60 * 1000);
        return Math.floor(mode.ichorPerHour * hours);
      },

      spendIchor: (amount) => {
        const state = get();
        if (state.ichorBalance < amount) return false;
        set({ ichorBalance: state.ichorBalance - amount });
        return true;
      },

      reset: () => set(initialState),
    }),
    {
      name: 'locked-in-brew',
      storage: createJSONStorage(() => asyncStorageAdapter),
    },
  ),
);
