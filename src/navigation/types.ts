import type { NavigatorScreenParams } from '@react-navigation/native';

// --- Auth Stack ---
export type AuthStackParamList = {
  WalletConnect: undefined;
};

// --- Onboarding Stack ---
export type OnboardingStackParamList = {
  CourseSelection: undefined;
  Deposit: { courseId: string };
};

// --- Main Stack (flat, dungeon-first) ---
export type MainStackParamList = {
  DungeonHome: undefined;
  CourseBrowser: undefined;
  Deposit: { courseId: string };
  Lesson: { lessonId: string; courseId: string };
  LessonResult: {
    lessonId: string;
    courseId: string;
    score: number;
    totalQuestions: number;
    accepted?: boolean;
    questionResults?: Array<{
      questionId: string;
      prompt: string;
      accepted: boolean;
      score: number;
      feedbackSummary: string;
    }>;
  };
  StreakStatus: undefined;
  Alchemy: undefined;
  Leaderboard: undefined;
  CommunityPot: undefined;
  CommunityPotWindow: { windowId: number; windowLabel: string };
  Profile: undefined;
  Inventory: undefined;
  IchorShop: undefined;
  ResurfaceHistory: { receiptId?: string } | undefined;
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
