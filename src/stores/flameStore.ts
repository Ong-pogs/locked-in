import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from './storage';
import type { FlameState, FlameData } from '@/types';

interface FlameStore extends FlameData {
  tickFlame: () => void;
  feedFlame: (tokens: number) => void;
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

function deriveFlameState(fuel: number): FlameState {
  if (fuel >= 3) return 'BURNING';
  if (fuel >= 1) return 'LIT';
  if (fuel > 0) return 'SPUTTERING';
  return 'COLD';
}

export const useFlameStore = create<FlameStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      tickFlame: () => {
        const state = get();
        const now = new Date();
        if (state.lastTickAt) {
          const last = new Date(state.lastTickAt);
          const daysPassed = Math.floor(
            (now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24),
          );
          if (daysPassed >= 1) {
            const newFuel = Math.max(0, state.fuelRemaining - daysPassed);
            const newState = deriveFlameState(newFuel);
            set({
              fuelRemaining: newFuel,
              flameState: newState,
              lightIntensity: INTENSITY_MAP[newState],
              lastTickAt: now.toISOString(),
            });
          }
        } else {
          set({ lastTickAt: now.toISOString() });
        }
      },

      feedFlame: (tokens) => {
        const state = get();
        const newFuel = state.fuelRemaining + tokens;
        const newState = deriveFlameState(newFuel);
        set({
          fuelRemaining: newFuel,
          flameState: newState,
          lightIntensity: INTENSITY_MAP[newState],
          lastTickAt: new Date().toISOString(),
        });
      },

      getLightIntensity: () => get().lightIntensity,

      reset: () => set(initialState),
    }),
    {
      name: 'locked-in-flame',
      storage: createJSONStorage(() => asyncStorageAdapter),
    },
  ),
);
