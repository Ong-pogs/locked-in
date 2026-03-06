export type ApiQuestionType = 'mcq' | 'short_text';
export type ApiLessonBlockType = 'paragraph' | 'code' | 'callout' | 'image';

export interface ApiCourseCard {
  id: string;
  slug: string;
  title: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  category: 'solana' | 'web3' | 'defi' | 'security' | 'rust';
  imageUrl: string | null;
  totalModules: number;
  totalLessons: number;
  publishedAt: string | null;
}

export interface ApiModuleCard {
  id: string;
  courseId: string;
  slug: string;
  title: string;
  description: string;
  order: number;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  totalLessons: number;
  estimatedMinutes: number;
}

export interface ApiLessonBlock {
  id: string;
  type: ApiLessonBlockType;
  order: number;
  text?: string;
  language?: string;
  calloutTone?: 'info' | 'warning' | 'tip';
  caption?: string;
  imageUrl?: string;
}

export interface ApiQuestionOption {
  id: string;
  text: string;
}

export interface ApiQuestion {
  id: string;
  type: ApiQuestionType;
  prompt: string;
  options?: ApiQuestionOption[];
  correctAnswer?: string;
}

export interface ApiLessonPayload {
  id: string;
  courseId: string;
  moduleId: string;
  title: string;
  order: number;
  version: number;
  releaseId: string;
  contentHash: string;
  blocks: ApiLessonBlock[];
  questions: ApiQuestion[];
}

export interface ApiContentVersion {
  releaseId: string;
  publishedAt: string;
}

export interface CourseCatalogSnapshot {
  courses: ApiCourseCard[];
  modules: ApiModuleCard[];
  lessons: ApiLessonPayload[];
  contentVersion: ApiContentVersion;
}

export interface AuthChallengeRequest {
  walletAddress: string;
}

export interface AuthChallengeResponse {
  challengeId: string;
  message: string;
  expiresAt: string;
}

export interface AuthVerifyRequest {
  walletAddress: string;
  challengeId: string;
  signature: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface AuthRefreshRequest {
  refreshToken: string;
}

export interface ProgressStartLessonRequest {
  attemptId: string;
  startedAt?: string;
}

export interface ProgressStartLessonResponse {
  lessonId: string;
  attemptId: string;
  startedAt: string;
}

export interface ProgressAnswerSubmission {
  questionId: string;
  answerText: string;
}

export interface ProgressSubmitLessonRequest {
  attemptId: string;
  answers: ProgressAnswerSubmission[];
  startedAt?: string;
  completedAt?: string;
}

export type ApiFuelEarnStatus =
  | 'PAUSED_RECOVERY'
  | 'AT_CAP'
  | 'EARNED_TODAY'
  | 'AVAILABLE';

export interface CourseRuntimeSnapshot {
  courseId: string;
  currentStreak: number;
  longestStreak: number;
  gauntletActive: boolean;
  gauntletDay: number;
  saverCount: number;
  saverRecoveryMode: boolean;
  currentYieldRedirectBps: number;
  extensionDays: number;
  fuelCounter: number;
  fuelCap: number;
  lastFuelCreditDay: string | null;
  lastBrewerBurnTs: string | null;
  fuelAwarded: number;
  fuelEarnStatus: ApiFuelEarnStatus;
}

export interface ProgressSubmitLessonResponse {
  lessonId: string;
  attemptId: string;
  accepted: boolean;
  score: number;
  totalQuestions: number;
  correctAnswers: number;
  completedAt: string;
  completionEventId?: string;
  courseRuntime?: CourseRuntimeSnapshot;
}

export interface CourseProgressSnapshot {
  courseId: string;
  completedLessons: number;
  totalLessons: number;
  completionRate: number;
}

export interface ModuleProgressSnapshot {
  moduleId: string;
  completedLessons: number;
  totalLessons: number;
  completionRate: number;
}
