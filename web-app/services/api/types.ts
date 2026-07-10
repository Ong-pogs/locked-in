export type ApiQuestionType = 'mcq' | 'short_text';
export type ApiLessonBlockType = 'paragraph' | 'code' | 'callout' | 'image';

export interface ApiCourseLockPolicy {
  minPrincipalAmountUi: string;
  maxPrincipalAmountUi: string | null;
  demoPrincipalAmountUi: string | null;
  minLockDurationDays: number;
  maxLockDurationDays: number;
}

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
  lockPolicy: ApiCourseLockPolicy;
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

export type ApiBlockVariant =
  | 'analogy'
  | 'flow'
  | 'concepts'
  | 'comparison'
  | 'chain-cards'
  | 'scam'
  | 'checklist'
  | 'takeaway'
  | 'kv-grid';

export interface ApiFlowStep {
  title: string;
  desc: string;
  icon?: string | null;
  color?: string;
}

export interface ApiConceptItem {
  icon: string;
  name: string;
  desc: string;
}

export interface ApiChainCard {
  name: string;
  tagline: string;
  desc: string;
  stats: string[];
  theme: 'btc' | 'eth' | 'sol';
}

export interface ApiKVItem {
  label: string;
  value: string;
  desc?: string;
  color?: 'default' | 'red' | 'green' | 'amber';
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
  variant?: ApiBlockVariant;
  title?: string;
  steps?: ApiFlowStep[];
  items?: (ApiConceptItem | ApiKVItem | string)[];
  chains?: ApiChainCard[];
  headers?: string[];
  rows?: string[][];
  highlightRow?: number | null;
  number?: number;
  example?: string;
  exampleSender?: string;
  rule?: string;
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
  // null for MCQs (no LLM validator ran); the answer key is revealed only in
  // this post-submit response, never in the lesson payload.
  score: number | null;
  feedbackSummary: string | null;
  validatorVersion: string | null;
  decisionHash: string | null;
  isCorrect: boolean;
  correctAnswer: string | null;
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
  fuelFragmentAwarded: number;
  fuelFragmentsToday: number;
  fuelEarnStatus: ApiFuelEarnStatus;
  fireLitUntil?: string | null;
  ichorCounter?: number;
  ichorLifetimeTotal?: number;
  // v2 shield/lapse engine state (spec §4.2) — flame gauge / shield pips /
  // penalty banner / CLAIM CTA. Optional until every backend is redeployed.
  shields?: number;
  lapseCount?: number;
  lapseOpen?: boolean;
  consecutiveLessonDays?: number;
  voucherAvailable?: boolean;
  lastCompletedDay?: string | null;
  completedToday?: boolean;
  dayEndsAtUtc?: string;
}

/** Live lock position from GET /v1/locks/:courseId/position (spec §4.2).
 * status is authoritative for the CLAIM CTA; liveValueUi is null when the
 * exchange rate is unreadable (render principal instead, never fabricate). */
export interface LockPositionResponse {
  courseId: string;
  status: 'NONE' | 'PENDING' | 'ACTIVE' | 'CLOSED';
  lockAddress: string | null;
  principalUi: string | null;
  liveValueUi: string | null;
  asOf: string;
  /** Stored/lazily-issued completion voucher (voucher-autoissue ruling R6):
   * non-null only for an ACTIVE lock on a completed course. Optional so older
   * backends parse cleanly; the POST voucher endpoint remains the claim-path
   * fallback and may never be removed. */
  voucher?: CompletionVoucherResponse | null;
}

/** GET /v1/locks/:courseId/eligibility (ruling R12) — the fail-closed
 * pre-deposit gate. Only a literal `{ eligible: true }` unblocks money;
 * no response / network error / eligible:false all block the deposit. */
export type LockIneligibleCode =
  | 'COURSE_NOT_FOUND'
  | 'COURSE_NOT_LOCKABLE'
  | 'COURSE_COMPLETED';

export type LockEligibilityResponse =
  | { eligible: true }
  | { eligible: false; code: LockIneligibleCode };

/** POST /v1/locks/:courseId/enroll 200 body (ruling R9). Failure codes:
 * 400 INVALID_LOCK_ADDRESS, 403 COURSE_COMPLETED / COURSE_NOT_LOCKABLE,
 * 404 COURSE_NOT_FOUND, 409 LOCK_ADDRESS_MISMATCH (config-skew tripwire),
 * 409 ENROLL_RETRY with { retryable: true, retryAfterMs } (RPC lag — retry). */
export interface EnrollLockResponse {
  enrolled: true;
  courseId: string;
  lockAddress: string;
  principalUi: string;
  status: 'ACTIVE';
  freshEnrollment: boolean;
  engineReset: boolean;
}

/** Extra fields on the 409 ENROLL_RETRY error body (ruling R6). */
export interface EnrollRetryErrorDetails {
  retryable: boolean;
  retryAfterMs: number;
}

/** Signed completion voucher from POST /v1/progress/courses/:courseId/voucher.
 * message/signature are base64; embed in an Ed25519 precompile ix before claim_v2. */
export interface CompletionVoucherResponse {
  courseId: string;
  lapseCount: number;
  lock: string;
  authorityPubkey: string;
  bps: number;
  expiry: number;
  message: string;
  signature: string;
}

/* ── Brewery (fire-timer model) ─────────────────────────────────────── */

export interface BreweryDayStripEntry {
  day: string; // YYYY-MM-DD UTC
  userAmount: string; // USDC base units (6 decimals) as decimal string
  potAmount: string;
  harvestCount: number;
}

export interface BreweryStateResponse {
  fuelCounter: number;
  fuelCap: number;
  fireLitUntil: string | null;
  isLit: boolean;
  saverCount: number; // savers used (0=full, 3=all spent)
  saversBanked: number; // 3 - saverCount
  currentYieldRedirectBps: number; // 0/1000/1500/2000 by saver tier
  ichorCounter: number;
  unclaimedYieldAmount: string; // USDC base units
  claimedYieldAmount: string;
  last7Days: BreweryDayStripEntry[];
}

export interface BuyStreakSaverResponse {
  applied: boolean;
  reason:
    | 'SAVER_BOUGHT'
    | 'SAVERS_FULL'
    | 'INSUFFICIENT_ICHOR'
    | 'NO_DATABASE';
  ichorSpent?: number;
  required?: number;
  have?: number;
  courseRuntime?: CourseRuntimeSnapshot;
}

export interface BreweryFeedResponse {
  applied: boolean;
  reason: 'FIRE_FED' | 'NO_FUEL' | 'NO_DATABASE';
  courseRuntime?: CourseRuntimeSnapshot;
}

export interface BreweryClaimResponse {
  applied: boolean;
  reason: 'CLAIMED' | 'NOTHING_TO_CLAIM' | 'NO_DATABASE';
  claimedAmount: string; // USDC base units
  receiptCount: number;
  transfer?: {
    signature?: string; // Solana tx signature for the devnet USDC transfer
    simulated?: boolean; // true when no treasury is configured (no transfer happened)
  };
}

export interface XpSnapshot {
  xpTotal: number;
  xpLevel: number;
  xpAwarded?: number;
  levelThresholds?: number[];
}

/** Response from GET /v1/progress/enrollments — all enrolled courses + progress for a wallet */
export interface UserEnrollmentsResponse {
  enrollments: {
    courseId: string;
    enrolledAt: string;
    runtime: CourseRuntimeSnapshot | null;
  }[];
  lessonProgress: {
    lessonId: string;
    completed: boolean;
    score: number;
    completedAt: string;
  }[];
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
  /** Practice-mode ruling R8/R10: true when the attempt was a replay or the
   * course is complete — graded normally, but streak/shields/rewards are
   * untouched server-side. Results page shows a notice when true. */
  practiceMode?: boolean;
  courseRuntime?: CourseRuntimeSnapshot;
  questionResults?: QuestionValidationResult[];
  xp?: XpSnapshot;
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
export type LeaderboardSource = 'materialized' | 'live';

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
  source: LeaderboardSource;
  snapshotAt: string | null;
  page: number;
  pageSize: number;
  totalEntries: number;
  totalPages: number;
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

export type RuntimeAuditEventType = 'FUEL_BURN' | 'MISS';
export type RuntimeRelayStatus = 'pending' | 'publishing' | 'published' | 'failed';

export interface RuntimeAuditEvent {
  eventType: RuntimeAuditEventType;
  eventId: string;
  occurredAt: string;
  eventDay: string | null;
  applied: boolean;
  reason: string | null;
  fuelBefore: number | null;
  fuelAfter: number | null;
  saverCountBefore: number | null;
  saverCountAfter: number | null;
  redirectBpsBefore: number | null;
  redirectBpsAfter: number | null;
  extensionDaysBefore: number | null;
  extensionDaysAfter: number | null;
  lockVaultStatus: RuntimeRelayStatus;
  lockVaultTransactionSignature: string | null;
  lockVaultLastError: string | null;
}

export interface RuntimeHistoryResponse {
  courseId: string;
  burnCount: number;
  missCount: number;
  extensionDaysAdded: number;
  events: RuntimeAuditEvent[];
}

export interface UnlockReceiptPayload {
  courseId: string;
  lockAccountAddress: string;
  principalAmountUi: string;
  lockEndDate: string;
  unlockedAt?: string;
  unlockTxSignature: string;
}

export interface UnlockReceiptRecord {
  unlockTxSignature: string;
  walletAddress: string;
  courseId: string;
  lockAccountAddress: string;
  principalAmountUi: string;
  lockEndAt: string;
  unlockedAt: string;
  verifiedSlot: number | null;
  verifiedBlockTime: string | null;
  createdAt?: string;
}

export interface UnlockReceiptHistoryResponse {
  receipts: UnlockReceiptRecord[];
}
