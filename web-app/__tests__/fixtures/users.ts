import type { UserProfile } from '@/types';

export function buildUser(overrides?: Partial<UserProfile>): UserProfile {
  return {
    walletAddress: 'TestWa11etAddress1111111111111111111111111',
    walletAuthToken: null,
    displayName: 'Test User',
    avatarUrl: null,
    onboardingPhase: 'main',
    createdAt: new Date().toISOString(),
    tutorialCompleted: false,
    authToken: null,
    refreshToken: null,
    ...overrides,
  };
}

export const TEST_WALLET = 'TestWa11etAddress1111111111111111111111111';
export const TEST_AUTH_TOKEN = 'mock-jwt-access-token';
export const TEST_REFRESH_TOKEN = 'mock-jwt-refresh-token';
