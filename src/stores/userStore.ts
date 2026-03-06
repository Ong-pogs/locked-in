import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from './storage';
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
  completeGauntlet: () => void;
}

const initialState: UserProfile = {
  walletAddress: null,
  walletAuthToken: null,
  displayName: null,
  avatarUrl: null,
  onboardingPhase: 'auth',
  createdAt: null,
  gauntletStartDate: null,
  gauntletCompleted: false,
  authToken: null,
  refreshToken: null,
};

export const useUserStore = create<UserStore>()(
  persist(
    (set) => ({
      ...initialState,

      setWallet: (address, walletAuthToken, authToken, refreshToken) =>
        set((state) => ({
          walletAddress: address,
          walletAuthToken: walletAuthToken ?? state.walletAuthToken ?? null,
          authToken: authToken ?? state.authToken ?? null,
          refreshToken: refreshToken ?? state.refreshToken ?? null,
          // Preserve existing phase for returning users.
          onboardingPhase:
            state.walletAddress == null ? 'onboarding' : state.onboardingPhase,
          createdAt: state.createdAt ?? new Date().toISOString(),
        })),

      setAuthToken: (authToken) => set({ authToken }),
      setRefreshToken: (refreshToken) => set({ refreshToken }),
      setAuthSession: (authToken, refreshToken) => set({ authToken, refreshToken }),

      disconnect: () => set(initialState),

      setOnboardingPhase: (phase) => set({ onboardingPhase: phase }),

      setDisplayName: (name) => set({ displayName: name }),

      completeGauntlet: () =>
        set({ gauntletCompleted: true, onboardingPhase: 'main' }),
    }),
    {
      name: 'locked-in-user',
      storage: createJSONStorage(() => asyncStorageAdapter),
    },
  ),
);
