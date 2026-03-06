export type OnboardingPhase = 'auth' | 'onboarding' | 'gauntlet' | 'main';

export interface UserProfile {
  walletAddress: string | null;
  /** Wallet-provider session token (MWA / wallet auth token) */
  walletAuthToken: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  onboardingPhase: OnboardingPhase;
  createdAt: string | null;
  gauntletStartDate: string | null;
  gauntletCompleted: boolean;
  /** Lesson API access token (Bearer) */
  authToken: string | null;
  /** Lesson API refresh token for silent access-token renewal */
  refreshToken: string | null;
}
