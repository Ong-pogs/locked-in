import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from './storage';
import type { StreakState } from '@/types';

interface StreakStore extends StreakState {
  completeDay: () => void;
  useSaver: () => boolean;
  checkAndUpdateStreak: () => void;
  reset: () => void;
}

const initialState: StreakState = {
  currentStreak: 0,
  longestStreak: 0,
  saverCount: 0,
  saverRecoveryMode: false,
  lastCompletedDate: null,
  dayNumber: 1,
  todayCompleted: false,
};

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

export const useStreakStore = create<StreakStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      completeDay: () => {
        const today = getToday();
        const state = get();
        if (state.lastCompletedDate === today) return;

        const newStreak = state.currentStreak + 1;
        set({
          currentStreak: newStreak,
          longestStreak: Math.max(newStreak, state.longestStreak),
          lastCompletedDate: today,
          dayNumber: state.dayNumber + 1,
          todayCompleted: true,
          saverRecoveryMode: false,
        });
      },

      useSaver: () => {
        const state = get();
        // No savers during Week 1 gauntlet (days 1-7)
        if (state.dayNumber <= 7) return false;
        // Savers unlock from Day 8, max 3
        if (state.saverCount >= 3) return false;

        set({
          saverCount: Math.min(state.saverCount + 1, 3) as 0 | 1 | 2 | 3,
          saverRecoveryMode: true,
          lastCompletedDate: getToday(),
        });
        return true;
      },

      checkAndUpdateStreak: () => {
        const state = get();
        const today = getToday();
        if (state.lastCompletedDate === today) {
          set({ todayCompleted: true });
          return;
        }

        // Check if yesterday was completed
        if (state.lastCompletedDate) {
          const last = new Date(state.lastCompletedDate);
          const now = new Date(today);
          const diffDays = Math.floor(
            (now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24),
          );

          if (diffDays > 1) {
            // Streak broken
            set({ currentStreak: 0, todayCompleted: false });
          } else {
            set({ todayCompleted: false });
          }
        }
      },

      reset: () => set(initialState),
    }),
    {
      name: 'locked-in-streak',
      storage: createJSONStorage(() => asyncStorageAdapter),
    },
  ),
);
