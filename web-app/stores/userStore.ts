import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { webStorageAdapter } from './storage';
import type { OnboardingPhase, UserProfile } from '@/types';

interface UserStore extends UserProfile {
  setWallet: (
    address: string,
    walletAuthToken?: string,
    authToken?: string,
    refreshToken?: string,
  ) => void;
  setAuthToken: (authToken: string | null) => void;
  setRefreshToken: (refreshToken: string | null) => void;
  setAuthSession: (authToken: string | null, refreshToken: string | null) => void;
  disconnect: () => void;
  setOnboardingPhase: (phase: OnboardingPhase) => void;
  setDisplayName: (name: string) => void;
  completeTutorial: () => void;
}

const initialState: UserProfile = {
  walletAddress: null,
  walletAuthToken: null,
  displayName: null,
  avatarUrl: null,
  onboardingPhase: 'auth',
  createdAt: null,
  tutorialCompleted: false,
  authToken: null,
  refreshToken: null,
};

export const useUserStore = create<UserStore>()(
  persist(
    (set) => ({
      ...initialState,

      setWallet: (address, walletAuthToken, authToken, refreshToken) =>
        set((state) => ({
          ...(state.walletAddress && state.walletAddress !== address
            ? {
                onboardingPhase: 'onboarding',
                displayName: null,
                avatarUrl: null,
                tutorialCompleted: false,
                createdAt: new Date().toISOString(),
              }
            : {
                // Any successful wallet connect should leave auth gate.
                onboardingPhase:
                  state.onboardingPhase === 'auth' ? 'onboarding' : state.onboardingPhase,
                createdAt: state.createdAt ?? new Date().toISOString(),
              }),
          walletAddress: address,
          walletAuthToken:
            state.walletAddress && state.walletAddress !== address
              ? walletAuthToken ?? null
              : walletAuthToken ?? state.walletAuthToken ?? null,
          authToken:
            state.walletAddress && state.walletAddress !== address
              ? authToken ?? null
              : authToken ?? state.authToken ?? null,
          refreshToken:
            state.walletAddress && state.walletAddress !== address
              ? refreshToken ?? null
              : refreshToken ?? state.refreshToken ?? null,
        })),

      setAuthToken: (authToken) => set({ authToken }),
      setRefreshToken: (refreshToken) => set({ refreshToken }),
      setAuthSession: (authToken, refreshToken) => set({ authToken, refreshToken }),

      disconnect: () =>
        set((state) => ({
          ...initialState,
          // Preserve UX flags — reset only on wallet change (setWallet)
          tutorialCompleted: state.tutorialCompleted,
        })),

      setOnboardingPhase: (phase) => set({ onboardingPhase: phase }),

      setDisplayName: (name) => set({ displayName: name }),

      completeTutorial: () => {
        set({ tutorialCompleted: true });
        // Cookie needed for server-side checks; localStorage handled by Zustand persist middleware
        try { document.cookie = 'locked-in-tutorial-done=1; path=/; max-age=31536000; samesite=lax'; } catch {}
      },
    }),
    {
      name: 'locked-in-user',
      version: 1,
      storage: createJSONStorage(() => webStorageAdapter),
      migrate: (persistedState) => {
        return (persistedState ?? {}) as UserStore;
      },
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<UserStore>) };
        // Migrate legacy 'gauntlet' phase to 'main'
        if ((merged.onboardingPhase as string) === 'gauntlet') {
          merged.onboardingPhase = 'main';
        }
        // Restore tutorialCompleted from direct flags outside Zustand
        // localStorage flag survives store resets; cookie survives localStorage.clear()
        try {
          const hasLocalFlag = localStorage.getItem('locked-in-tutorial-done') === '1';
          const hasCookie = document.cookie.includes('locked-in-tutorial-done=1');
          if (hasLocalFlag || hasCookie) {
            merged.tutorialCompleted = true;
          }
          // Backfill: if store says done but cookie/flag missing, set them
          if (merged.tutorialCompleted) {
            if (!hasLocalFlag) localStorage.setItem('locked-in-tutorial-done', '1');
            if (!hasCookie) document.cookie = 'locked-in-tutorial-done=1; path=/; max-age=31536000; samesite=lax';
          }
        } catch {}
        return merged;
      },
    },
  ),
);
