import type { NavigatorScreenParams } from '@react-navigation/native';

// --- Auth Stack ---
export type AuthStackParamList = {
  WalletConnect: undefined;
};

// --- Onboarding Stack ---
export type OnboardingStackParamList = {
  CourseSelection: undefined;
  Deposit: undefined;
  GauntletRoom: undefined;
};

// --- Main Stack ---
export type MainStackParamList = {
  UndergroundHub: undefined;
  CourseBrowser: undefined;
  Lesson: { lessonId: string; courseId: string };
  LessonResult: { lessonId: string; score: number };
  FlameDashboard: undefined;
  Alchemy: undefined;
  Leaderboard: undefined;
  Profile: undefined;
};

// --- Root ---
export type RootParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Onboarding: NavigatorScreenParams<OnboardingStackParamList>;
  Main: NavigatorScreenParams<MainStackParamList>;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootParamList {}
  }
}
