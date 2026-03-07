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

export interface QuestionValidationResult {
  questionId: string;
  prompt: string;
  accepted: boolean;
  score: number;
  feedbackSummary: string;
  validatorVersion: string;
  decisionHash: string;
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
  questionResults?: QuestionValidationResult[];
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

export type CommunityPotWindowStatus = 'OPEN' | 'CLOSED' | 'DISTRIBUTED';
export type CommunityPotRecipientStatus =
  | 'NONE'
  | 'PENDING'
  | 'PUBLISHING'
  | 'DISTRIBUTED'
  | 'FAILED';

export interface CommunityPotHistoryWindow {
  windowId: number;
  windowLabel: string;
  totalRedirectedAmount: string;
  totalRedirectedAmountUi: string;
  distributedAmount: string;
  distributedAmountUi: string;
  remainingAmount: string;
  remainingAmountUi: string;
  redirectCount: number;
  eligibleRecipientCount: number;
  distributionCount: number;
  status: CommunityPotWindowStatus;
  closedAt: string | null;
  userPayoutAmount: string | null;
  userPayoutAmountUi: string | null;
  userStatus: CommunityPotRecipientStatus;
  userDistributedAt: string | null;
  userTransactionSignature: string | null;
  userLastError: string | null;
}

export interface CommunityPotHistoryResponse {
  windows: CommunityPotHistoryWindow[];
}

export interface CommunityPotWindowRecipient {
  walletAddress: string;
  displayIdentity: string;
  courseId: string;
  currentStreak: number;
  principalAmount: string;
  principalAmountUi: string;
  weight: string;
  payoutAmount: string;
  payoutAmountUi: string;
  status: CommunityPotRecipientStatus;
  distributedAt: string | null;
  transactionSignature: string | null;
  lastError: string | null;
  isCurrentUser: boolean;
}

export interface CommunityPotWindowDetailResponse {
  windowId: number;
  windowLabel: string;
  totalRedirectedAmount: string;
  totalRedirectedAmountUi: string;
  distributedAmount: string;
  distributedAmountUi: string;
  remainingAmount: string;
  remainingAmountUi: string;
  redirectCount: number;
  eligibleRecipientCount: number;
  distributionCount: number;
  status: CommunityPotWindowStatus;
  closedAt: string | null;
  recipients: CommunityPotWindowRecipient[];
  userEntry: CommunityPotWindowRecipient | null;
}

export type LeaderboardEntryStatus = 'active' | 'broken';

export interface LeaderboardEntry {
  rank: number;
  walletAddress: string;
  displayIdentity: string;
  streakLength: number;
  streakStatus: LeaderboardEntryStatus;
  activeCourseCount: number;
  lockedPrincipalAmount: string;
  lockedPrincipalAmountUi: string;
  projectedCommunityPotShare: string;
  projectedCommunityPotShareUi: string;
  recentActivityDate: string | null;
  isCurrentUser: boolean;
}

export interface LeaderboardResponse {
  currentPotSizeUi: string;
  nextDistributionWindowLabel: string | null;
  currentUser: LeaderboardEntry | null;
  entries: LeaderboardEntry[];
}

export type HarvestRelayStatus = 'pending' | 'publishing' | 'published' | 'failed';
export type HarvestKind = 'AUTO' | 'MANUAL';

export interface YieldHistoryEntry {
  harvestId: string;
  kind: HarvestKind;
  harvestedAt: string;
  grossYieldAmount: string;
  grossYieldAmountUi: string;
  applied: boolean | null;
  reason: string | null;
  platformFeeAmount: string;
  platformFeeAmountUi: string;
  redirectedAmount: string;
  redirectedAmountUi: string;
  ichorAwarded: string;
  yieldSplitterStatus: HarvestRelayStatus;
  yieldSplitterTransactionSignature: string | null;
  lockVaultStatus: HarvestRelayStatus;
  lockVaultTransactionSignature: string | null;
  communityPotStatus: HarvestRelayStatus;
  communityPotTransactionSignature: string | null;
}

export interface YieldHistoryResponse {
  courseId: string;
  totalHarvests: number;
  totalGrossYield: string;
  totalGrossYieldUi: string;
  totalPlatformFee: string;
  totalPlatformFeeUi: string;
  totalRedirected: string;
  totalRedirectedUi: string;
  totalIchorAwarded: string;
  entries: YieldHistoryEntry[];
}
