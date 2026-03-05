import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from './storage';
import type { FlameState, FlameData } from '@/types';

interface FlameStore extends FlameData {
  /** Derive flame state from current streak count */
  updateFromStreak: (streak: number) => void;
  feedFlame: (fuel: number) => void;
  getLightIntensity: () => number;
  reset: () => void;
}

const INTENSITY_MAP: Record<FlameState, number> = {
  BURNING: 1.0,
  LIT: 0.6,
  SPUTTERING: 0.25,
  COLD: 0.05,
};

const initialState: FlameData = {
  flameState: 'COLD',
  fuelRemaining: 0,
  lastTickAt: null,
  lightIntensity: 0.05,
};

function deriveFlameState(streak: number): FlameState {
  if (streak >= 3) return 'BURNING';
  if (streak >= 1) return 'LIT';
  return 'COLD';
}

export const useFlameStore = create<FlameStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      updateFromStreak: (streak) => {
        const newState = deriveFlameState(streak);
        set({
          flameState: newState,
          lightIntensity: INTENSITY_MAP[newState],
          fuelRemaining: streak, // store streak as "fuel" for backwards compat
        });
      },

      feedFlame: (fuel) => {
        const state = get();
        const nextFuel = Math.max(0, state.fuelRemaining + fuel);
        const nextFlameState =
          nextFuel >= 3 ? 'BURNING' : nextFuel >= 1 ? 'LIT' : 'COLD';

        set({
          fuelRemaining: nextFuel,
          flameState: nextFlameState,
          lightIntensity: INTENSITY_MAP[nextFlameState],
          lastTickAt: new Date().toISOString(),
        });
      },

      // Kept for backward compat but no-ops
      getLightIntensity: () => get().lightIntensity,

      reset: () => set(initialState),
    }),
    {
      name: 'locked-in-flame',
      storage: createJSONStorage(() => asyncStorageAdapter),
    },
  ),
);
