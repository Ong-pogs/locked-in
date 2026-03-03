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

// --- Main Tabs ---
export type MainTabsParamList = {
  Home: undefined;
  Courses: undefined;
  Dungeon: undefined;
  Profile: undefined;
};

// --- Main Stack ---
export type MainStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabsParamList>;
  Lesson: { lessonId: string; courseId: string };
  LessonResult: { lessonId: string; courseId: string; score: number; totalQuestions: number };
  FlameDashboard: undefined;
  Alchemy: undefined;
  Leaderboard: undefined;
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
