// Typed scenario objects for the v2 e2e suite. ONE object generates BOTH the
// Zustand localStorage seed and every route-mock body, so the store seed and
// the background sync (AppShell restoreFromBackend + DashboardV2 runtime
// refresh) can never disagree.
//
// All timestamps derive arithmetically from FIXED_EPOCH — `new Date()` is
// forbidden in fixture code (visual determinism under page.clock).

export const FIXED_EPOCH = new Date('2026-07-15T12:00:00Z');
const DAY_MS = 24 * 3600 * 1000;

export const WALLET = 'TestWa11etAddress1111111111111111111111111';
export const COURSE_ID = 'solana-101';
export const LOCK_ADDRESS = '6czu6E4765JzjVESkErbDrdXrdXf3xLWsYfSsBKYnhJb';

export interface V2Scenario {
  name: string;
  // engine state
  shields: number;
  lapseCount: number;
  lapseOpen: boolean;
  completedToday: boolean;
  currentStreak: number;
  // course progress
  completedLessons: number; // of 3
  voucherAvailable: boolean;
  // position
  positionStatus: 'NONE' | 'PENDING' | 'ACTIVE' | 'CLOSED';
  principalUi: string | null;
  liveValueUi: string | null;
}

export const SCENARIOS = {
  // Lesson done today, full shields — flame blazing.
  active: {
    name: 'active',
    shields: 3, lapseCount: 0, lapseOpen: false, completedToday: true, currentStreak: 5,
    completedLessons: 1, voucherAvailable: false,
    positionStatus: 'ACTIVE', principalUi: '50', liveValueUi: '50.3841',
  },
  // No lesson yet today, one shield burned — flickering + countdown.
  atRisk: {
    name: 'atRisk',
    shields: 2, lapseCount: 0, lapseOpen: false, completedToday: false, currentStreak: 5,
    completedLessons: 1, voucherAvailable: false,
    positionStatus: 'ACTIVE', principalUi: '50', liveValueUi: '50.3841',
  },
  // First lapse — dark, 50% penalty banner.
  lapsedOne: {
    name: 'lapsedOne',
    shields: 0, lapseCount: 1, lapseOpen: true, completedToday: false, currentStreak: 0,
    completedLessons: 2, voucherAvailable: false,
    positionStatus: 'ACTIVE', principalUi: '50', liveValueUi: '50.3841',
  },
  // Second lapse — extinguished, 100% penalty banner.
  lapsedTwo: {
    name: 'lapsedTwo',
    shields: 0, lapseCount: 2, lapseOpen: true, completedToday: false, currentStreak: 0,
    completedLessons: 2, voucherAvailable: false,
    positionStatus: 'ACTIVE', principalUi: '50', liveValueUi: '50.3841',
  },
  // Course complete, lock ACTIVE — CLAIM armed.
  claimable: {
    name: 'claimable',
    shields: 3, lapseCount: 0, lapseOpen: false, completedToday: true, currentStreak: 12,
    completedLessons: 3, voucherAvailable: true,
    positionStatus: 'ACTIVE', principalUi: '50', liveValueUi: '51.2130',
  },
  // Course complete but lock already claimed — practice badge.
  practice: {
    name: 'practice',
    shields: 3, lapseCount: 0, lapseOpen: false, completedToday: false, currentStreak: 0,
    completedLessons: 3, voucherAvailable: true,
    positionStatus: 'CLOSED', principalUi: null, liveValueUi: null,
  },
  // Rate unreadable — value falls back to principal.
  nullValue: {
    name: 'nullValue',
    shields: 3, lapseCount: 0, lapseOpen: false, completedToday: true, currentStreak: 2,
    completedLessons: 1, voucherAvailable: false,
    positionStatus: 'ACTIVE', principalUi: '50', liveValueUi: null,
  },
} satisfies Record<string, V2Scenario>;

export type ScenarioKey = keyof typeof SCENARIOS;

const LESSONS = [
  { id: 'lesson-1', title: 'Introduction' },
  { id: 'lesson-2', title: 'Accounts' },
  { id: 'lesson-3', title: 'Transactions' },
];

export function runtimeSnapshot(s: V2Scenario) {
  return {
    courseId: COURSE_ID,
    currentStreak: s.currentStreak,
    longestStreak: Math.max(s.currentStreak, 7),
    gauntletActive: false,
    gauntletDay: 8,
    saverCount: 0,
    saverRecoveryMode: false,
    currentYieldRedirectBps: 0,
    extensionDays: 0,
    fuelCounter: 3,
    fuelCap: 7,
    lastFuelCreditDay: null,
    lastBrewerBurnTs: null,
    fuelAwarded: 0,
    fuelFragmentAwarded: 0,
    fuelFragmentsToday: 0,
    fuelEarnStatus: 'AVAILABLE',
    shields: s.shields,
    lapseCount: s.lapseCount,
    lapseOpen: s.lapseOpen,
    consecutiveLessonDays: 1,
    lastCompletedDay: s.completedToday ? '2026-07-15' : '2026-07-14',
    completedToday: s.completedToday,
    dayEndsAtUtc: new Date(FIXED_EPOCH.getTime() + DAY_MS / 2).toISOString(), // 12h left
    voucherAvailable: s.voucherAvailable,
  };
}

export function positionResponse(s: V2Scenario) {
  return {
    courseId: COURSE_ID,
    status: s.positionStatus,
    lockAddress: s.positionStatus === 'NONE' ? null : LOCK_ADDRESS,
    principalUi: s.principalUi,
    liveValueUi: s.liveValueUi,
    asOf: FIXED_EPOCH.toISOString(),
  };
}

export function voucherResponse(s: V2Scenario) {
  const bps = [10_000, 5_000, 0][Math.min(s.lapseCount, 2)];
  return {
    courseId: COURSE_ID,
    lapseCount: s.lapseCount,
    lock: LOCK_ADDRESS,
    authorityPubkey: 'G6emPd5DtiK2Dnoc9zw2xL215Y7nqppBkvTqCw2S6QeG',
    bps,
    expiry: Math.floor(FIXED_EPOCH.getTime() / 1000) + 2 * 24 * 3600,
    message: Buffer.alloc(91).toString('base64'),
    signature: Buffer.alloc(64).toString('base64'),
  };
}

export function enrollmentsResponse(s: V2Scenario) {
  return {
    enrollments: [{ courseId: COURSE_ID, enrolledAt: new Date(FIXED_EPOCH.getTime() - 5 * DAY_MS).toISOString(), runtime: runtimeSnapshot(s) }],
    lessonProgress: LESSONS.slice(0, s.completedLessons).map((l, i) => ({
      lessonId: l.id,
      completed: true,
      score: 90,
      completedAt: new Date(FIXED_EPOCH.getTime() - (s.completedLessons - i) * DAY_MS).toISOString(),
    })),
  };
}

// Zustand persisted-store seeds (versioned wrapper per zustand/persist).
export function userStoreSeed() {
  return {
    state: {
      walletAddress: WALLET,
      walletAuthToken: 'mock-wallet-auth-token',
      displayName: 'Test User',
      avatarUrl: null,
      onboardingPhase: 'main' as const,
      createdAt: new Date(FIXED_EPOCH.getTime() - 30 * DAY_MS).toISOString(),
      dungeonTourCompleted: true,
      tutorialCompleted: true,
      authToken: 'mock-jwt-access-token',
      refreshToken: 'mock-jwt-refresh-token',
    },
    version: 0,
  };
}

export function courseStoreSeed(s: V2Scenario) {
  return {
    state: {
      courses: [
        {
          id: COURSE_ID,
          title: 'Solana 101',
          description: 'Learn the fundamentals of Solana development',
          totalLessons: 3,
          totalModules: 1,
          difficulty: 'beginner',
          category: 'solana',
          completedLessons: s.completedLessons,
        },
      ],
      modules: {},
      lessons: {
        [COURSE_ID]: LESSONS.map((l, i) => ({
          id: l.id, courseId: COURSE_ID, title: l.title, order: i + 1, moduleId: 'mod-1',
        })),
      },
      lessonProgress: Object.fromEntries(
        LESSONS.slice(0, s.completedLessons).map((l) => [
          l.id,
          { lessonId: l.id, courseId: COURSE_ID, completed: true, score: 90, completedAt: FIXED_EPOCH.toISOString() },
        ]),
      ),
      enrolledCourseIds: [COURSE_ID],
      activeCourseId: COURSE_ID,
      activeCourseIds: [COURSE_ID],
      courseStates: {
        [COURSE_ID]: {
          lockAccountAddress: s.positionStatus === 'NONE' || s.positionStatus === 'CLOSED' ? null : LOCK_ADDRESS,
          lockAmount: 50,
          lockDuration: 30,
          extensionDays: 0,
          lockStartDate: new Date(FIXED_EPOCH.getTime() - 5 * DAY_MS).toISOString(),
          currentStreak: s.currentStreak,
          longestStreak: Math.max(s.currentStreak, 7),
          saverCount: 0,
          fuelCounter: 3,
          fuelCap: 7,
          fuelFragmentsToday: 0,
          ichorBalance: 0,
          shields: s.shields,
          lapseCount: s.lapseCount,
          lapseOpen: s.lapseOpen,
          consecutiveLessonDays: 1,
          completedToday: s.completedToday,
          dayEndsAtUtc: new Date(FIXED_EPOCH.getTime() + DAY_MS / 2).toISOString(),
          voucherAvailable: s.voucherAvailable,
        },
      },
      contentReleaseId: '1',
      contentPublishedAt: new Date(FIXED_EPOCH.getTime() - 10 * DAY_MS).toISOString(),
      contentLoading: false,
      contentError: null,
      contentInitialized: true,
      boundWalletAddress: WALLET,
    },
    version: 0,
  };
}

export function coursesListResponse() {
  return [
    {
      id: COURSE_ID,
      slug: COURSE_ID,
      title: 'Solana 101',
      description: 'Learn the fundamentals of Solana development',
      difficulty: 'beginner',
      category: 'solana',
      imageUrl: null,
      totalModules: 1,
      totalLessons: 3,
      publishedAt: new Date(FIXED_EPOCH.getTime() - 10 * DAY_MS).toISOString(),
      lockPolicy: { minPrincipalUi: '10', maxPrincipalUi: '50' },
    },
  ];
}
