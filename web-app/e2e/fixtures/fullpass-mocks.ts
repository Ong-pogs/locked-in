// Typed scenario objects for the FULL-PASS e2e suite (e2e/tests-fullpass).
// Follows the v2-mocks contract: ONE scenario object generates BOTH the
// Zustand localStorage seed and every route-mock body, so the store seed and
// the background syncs (AppShell initializeContent + restoreFromBackend,
// DashboardV2 runtime/position polls) can never disagree.
//
// Unlike v2-mocks, lessons here carry FULL payloads (blocks + questions) so
// the recall interstitial and the check-to-lock quiz actually run — and the
// answer keys live ONLY in ANSWER_KEYS (fixture side), never in a payload,
// which is exactly the production integrity contract the recall-check and
// check endpoints exist for.
//
// All timestamps derive arithmetically from FIXED_EPOCH — `new Date()` is
// forbidden in fixture code (visual determinism under page.clock).

import { FIXED_EPOCH, WALLET } from './v2-mocks';

const DAY_MS = 24 * 3600 * 1000;

export const FP_RELEASE_ID = 'fullpass-release-1';
export const FP_LOCK_ADDRESS = '6czu6E4765JzjVESkErbDrdXrdXf3xLWsYfSsBKYnhJb';

export type FpPositionStatus = 'NONE' | 'PENDING' | 'ACTIVE' | 'CLOSED';

/* ── Deterministic catalog ─────────────────────────────────────────────
 * COURSE_A is the "working" course: lesson 1 done (the recall source has
 * EXACTLY ONE question so the random recall pick is deterministic), lesson 2
 * is the walkthrough target. COURSE_B is a finished course (Claimed-tab /
 * completed-badge material). COURSE_C is untouched (negative badge case). */

export interface FpQuestionSeed {
  id: string;
  prompt: string;
  options: { id: string; text: string }[];
  /** Fixture-side answer key. NEVER shipped in a lesson payload. */
  correctText: string;
}

export interface FpLessonSeed {
  id: string;
  title: string;
  order: number;
  blocks: { id: string; text: string }[];
  questions: FpQuestionSeed[];
}

export interface FpCourseSeed {
  id: string;
  title: string;
  description: string;
  lessons: FpLessonSeed[];
}

export const COURSE_A: FpCourseSeed = {
  id: 'fullpass-101',
  title: 'Fullpass Foundations',
  description: 'Anchor programs from zero to deployed.',
  lessons: [
    {
      id: 'fp-l1',
      title: 'Anchor Basics',
      order: 1,
      blocks: [
        {
          id: 'fp-l1-b1',
          text: 'Anchor wraps Solana programs in Rust macros so account constraints are validated declaratively.',
        },
      ],
      // Exactly ONE question: the recall interstitial for lesson 2 picks
      // randomly from prior completed lessons — a single-question pool makes
      // the pick deterministic.
      questions: [
        {
          id: 'fp-l1-q1',
          prompt: 'Which command compiles an Anchor program?',
          options: [
            { id: 'fp-l1-q1-a', text: 'anchor build' },
            { id: 'fp-l1-q1-b', text: 'cargo publish' },
            { id: 'fp-l1-q1-c', text: 'solana airdrop' },
          ],
          correctText: 'anchor build',
        },
      ],
    },
    {
      id: 'fp-l2',
      title: 'Deploying Programs',
      order: 2,
      blocks: [
        {
          id: 'fp-l2-b1',
          text: 'A deploy uploads compiled BPF bytecode into a program account on the cluster.',
        },
        {
          id: 'fp-l2-b2',
          text: 'Rehearse every release against a free cluster before it touches real funds.',
        },
      ],
      questions: [
        {
          id: 'fp-l2-q1',
          prompt: 'Which cluster costs nothing to deploy to?',
          options: [
            { id: 'fp-l2-q1-a', text: 'Devnet' },
            { id: 'fp-l2-q1-b', text: 'Mainnet beta' },
            { id: 'fp-l2-q1-c', text: 'An RPC archive node' },
          ],
          correctText: 'Devnet',
        },
        {
          id: 'fp-l2-q2',
          prompt: 'What signs a program deploy transaction?',
          options: [
            { id: 'fp-l2-q2-a', text: 'The upgrade authority keypair' },
            { id: 'fp-l2-q2-b', text: 'The token mint' },
            { id: 'fp-l2-q2-c', text: 'A vote account' },
          ],
          correctText: 'The upgrade authority keypair',
        },
      ],
    },
  ],
};

export const COURSE_B: FpCourseSeed = {
  id: 'fullpass-201',
  title: 'Vault Mastery',
  description: 'How principal, shares and yield settle in the vault.',
  lessons: [
    {
      id: 'fp-b1',
      title: 'Shares and Rates',
      order: 1,
      blocks: [
        {
          id: 'fp-b1-b1',
          text: 'Deposits mint vault shares; the exchange rate drifts upward as yield accrues.',
        },
      ],
      questions: [
        {
          id: 'fp-b1-q1',
          prompt: 'What do you receive when you deposit into the vault?',
          options: [
            { id: 'fp-b1-q1-a', text: 'Vault shares' },
            { id: 'fp-b1-q1-b', text: 'A new mint' },
          ],
          correctText: 'Vault shares',
        },
      ],
    },
    {
      id: 'fp-b2',
      title: 'Settling a Claim',
      order: 2,
      blocks: [
        {
          id: 'fp-b2-b1',
          text: 'A claim burns your shares, returns principal plus kept yield, and closes the lock.',
        },
      ],
      questions: [
        {
          id: 'fp-b2-q1',
          prompt: 'What happens to the lock account after a successful claim?',
          options: [
            { id: 'fp-b2-q1-a', text: 'It closes' },
            { id: 'fp-b2-q1-b', text: 'It doubles' },
          ],
          correctText: 'It closes',
        },
      ],
    },
  ],
};

export const COURSE_C: FpCourseSeed = {
  id: 'fullpass-301',
  title: 'Rust Warmup',
  description: 'Ownership and borrowing before you touch a program.',
  lessons: [
    {
      id: 'fp-c1',
      title: 'Ownership',
      order: 1,
      blocks: [
        { id: 'fp-c1-b1', text: 'Every value in Rust has exactly one owner at a time.' },
      ],
      questions: [
        {
          id: 'fp-c1-q1',
          prompt: 'How many owners can a Rust value have at once?',
          options: [
            { id: 'fp-c1-q1-a', text: 'Exactly one' },
            { id: 'fp-c1-q1-b', text: 'Unlimited' },
          ],
          correctText: 'Exactly one',
        },
      ],
    },
  ],
};

export const ALL_COURSES: FpCourseSeed[] = [COURSE_A, COURSE_B, COURSE_C];

/** Fixture-side answer key (question id → correct option TEXT). The graders
 * (recall-check / check / submit mocks) read this; payloads never carry it. */
export const ANSWER_KEYS: Record<string, string> = Object.fromEntries(
  ALL_COURSES.flatMap((c) =>
    c.lessons.flatMap((l) => l.questions.map((q) => [q.id, q.correctText])),
  ),
);

export function normalizeAnswer(s: string): string {
  return s.trim().toLowerCase();
}

/* ── Scenarios ───────────────────────────────────────────────────────── */

export interface FpCourseState {
  course: FpCourseSeed;
  enrolled: boolean;
  completedLessonIds: string[];
  positionStatus: FpPositionStatus;
  principalUi: string | null;
  liveValueUi: string | null;
  voucherAvailable: boolean;
  currentStreak: number;
  completedToday: boolean;
}

export interface FpScenario {
  name: string;
  courses: FpCourseState[];
}

const A_LEARNING: FpCourseState = {
  course: COURSE_A,
  enrolled: true,
  completedLessonIds: ['fp-l1'],
  positionStatus: 'ACTIVE',
  principalUi: '50',
  liveValueUi: '50.3841',
  voucherAvailable: false,
  currentStreak: 4,
  completedToday: true,
};

const B_CLAIMED: FpCourseState = {
  course: COURSE_B,
  enrolled: true,
  completedLessonIds: ['fp-b1', 'fp-b2'],
  positionStatus: 'CLOSED',
  principalUi: null,
  liveValueUi: null,
  voucherAvailable: true,
  currentStreak: 0,
  completedToday: false,
};

const C_UNTOUCHED: FpCourseState = {
  course: COURSE_C,
  enrolled: false,
  completedLessonIds: [],
  positionStatus: 'NONE',
  principalUi: null,
  liveValueUi: null,
  voucherAvailable: false,
  currentStreak: 0,
  completedToday: false,
};

export const FP_SCENARIOS = {
  // Mid-course user: lesson 1 of course A done, live ACTIVE position.
  // The lesson-flow specs (recall + quiz) and the "fresh user" Claimed-tab
  // empty state run on this.
  learning: { name: 'learning', courses: [A_LEARNING] },

  // One live course + one settled course + one untouched course — the
  // dashboard tabs and the courses-page completed badge run on this.
  mixed: { name: 'mixed', courses: [A_LEARNING, B_CLAIMED, C_UNTOUCHED] },

  // Course A fully complete, lock still ACTIVE, voucher armed — CLAIM path.
  claimable: {
    name: 'claimable',
    courses: [
      {
        course: COURSE_A,
        enrolled: true,
        completedLessonIds: ['fp-l1', 'fp-l2'],
        positionStatus: 'ACTIVE',
        principalUi: '50',
        liveValueUi: '51.2130',
        voucherAvailable: true,
        currentStreak: 9,
        completedToday: true,
      },
    ],
  },

  // Everything the user ever locked is settled — Active tab is empty.
  onlyClaimed: { name: 'onlyClaimed', courses: [B_CLAIMED] },
} satisfies Record<string, FpScenario>;

export type FpScenarioKey = keyof typeof FP_SCENARIOS;

/* ── Lookup helpers ──────────────────────────────────────────────────── */

export function scenarioCourse(s: FpScenario, courseId: string): FpCourseState | null {
  return s.courses.find((c) => c.course.id === courseId) ?? null;
}

export function scenarioCourseForLesson(s: FpScenario, lessonId: string): FpCourseState | null {
  return (
    s.courses.find((c) => c.course.lessons.some((l) => l.id === lessonId)) ?? null
  );
}

function moduleIdFor(courseId: string): string {
  return `${courseId}-mod-1`;
}

/* ── API response builders (shapes per services/api/types.ts) ────────── */

export function fpCoursesListResponse(s: FpScenario) {
  return s.courses.map(({ course }) => ({
    id: course.id,
    slug: course.id,
    title: course.title,
    description: course.description,
    difficulty: 'beginner',
    category: 'solana',
    imageUrl: null,
    totalModules: 1,
    totalLessons: course.lessons.length,
    publishedAt: new Date(FIXED_EPOCH.getTime() - 10 * DAY_MS).toISOString(),
    lockPolicy: { minPrincipalUi: '10', maxPrincipalUi: '50' },
  }));
}

export function fpModulesResponse(s: FpScenario, courseId: string) {
  const cs = scenarioCourse(s, courseId);
  if (!cs) return [];
  return [
    {
      id: moduleIdFor(courseId),
      courseId,
      slug: `${courseId}-module-1`,
      title: 'Module 1',
      description: cs.course.description,
      order: 1,
      difficulty: 'beginner',
      totalLessons: cs.course.lessons.length,
      estimatedMinutes: 10,
    },
  ];
}

/** ApiLessonPayload — questions WITHOUT correctAnswer (integrity contract). */
function fpLessonPayload(course: FpCourseSeed, lesson: FpLessonSeed) {
  return {
    id: lesson.id,
    courseId: course.id,
    moduleId: moduleIdFor(course.id),
    order: lesson.order,
    title: lesson.title,
    blocks: lesson.blocks.map((b, i) => ({
      id: b.id,
      type: 'paragraph',
      order: i + 1,
      text: b.text,
    })),
    questions: lesson.questions.map((q) => ({
      id: q.id,
      type: 'mcq',
      prompt: q.prompt,
      options: q.options.map((o) => ({ id: o.id, text: o.text })),
    })),
    version: 1,
    releaseId: FP_RELEASE_ID,
    contentHash: `hash-${lesson.id}`,
  };
}

export function fpLessonsForModule(s: FpScenario, moduleId: string) {
  const cs = s.courses.find((c) => moduleIdFor(c.course.id) === moduleId);
  if (!cs) return [];
  return cs.course.lessons.map((l) => fpLessonPayload(cs.course, l));
}

export function fpRuntimeSnapshot(cs: FpCourseState) {
  return {
    courseId: cs.course.id,
    currentStreak: cs.currentStreak,
    longestStreak: Math.max(cs.currentStreak, 7),
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
    shields: 3,
    lapseCount: 0,
    lapseOpen: false,
    consecutiveLessonDays: 1,
    lastCompletedDay: cs.completedToday ? '2026-07-15' : '2026-07-14',
    completedToday: cs.completedToday,
    dayEndsAtUtc: new Date(FIXED_EPOCH.getTime() + DAY_MS / 2).toISOString(),
    voucherAvailable: cs.voucherAvailable,
  };
}

export function fpPositionResponse(
  courseId: string,
  cs: FpCourseState | null,
  statusOverride?: FpPositionStatus,
) {
  const status = statusOverride ?? cs?.positionStatus ?? 'NONE';
  const settled = status === 'NONE' || status === 'CLOSED';
  return {
    courseId,
    status,
    lockAddress: status === 'NONE' ? null : FP_LOCK_ADDRESS,
    principalUi: settled ? null : cs?.principalUi ?? null,
    liveValueUi: settled ? null : cs?.liveValueUi ?? null,
    asOf: FIXED_EPOCH.toISOString(),
  };
}

export function fpEnrollmentsResponse(s: FpScenario) {
  const enrolled = s.courses.filter((c) => c.enrolled);
  return {
    enrollments: enrolled.map((c) => ({
      courseId: c.course.id,
      enrolledAt: new Date(FIXED_EPOCH.getTime() - 5 * DAY_MS).toISOString(),
      runtime: fpRuntimeSnapshot(c),
    })),
    lessonProgress: enrolled.flatMap((c) =>
      c.completedLessonIds.map((lessonId, i) => ({
        lessonId,
        completed: true,
        score: 100,
        completedAt: new Date(
          FIXED_EPOCH.getTime() - (c.completedLessonIds.length - i) * DAY_MS,
        ).toISOString(),
      })),
    ),
  };
}

export function fpVoucherResponse(courseId: string, expired: boolean) {
  return {
    courseId,
    lapseCount: 0,
    lock: FP_LOCK_ADDRESS,
    authorityPubkey: 'G6emPd5DtiK2Dnoc9zw2xL215Y7nqppBkvTqCw2S6QeG',
    bps: 10_000,
    expiry:
      Math.floor(FIXED_EPOCH.getTime() / 1000) + (expired ? -3600 : 2 * 24 * 3600),
    message: Buffer.alloc(91).toString('base64'),
    signature: Buffer.alloc(64).toString('base64'),
  };
}

/** Grade a submit body against ANSWER_KEYS — the mock server's whole brain. */
export function gradeSubmission(
  lessonId: string,
  body: { attemptId: string; answers?: { questionId: string; answerText: string }[] },
  cs: FpCourseState | null,
) {
  const answers = body.answers ?? [];
  const lesson = cs?.course.lessons.find((l) => l.id === lessonId) ?? null;
  const promptFor = (questionId: string) =>
    lesson?.questions.find((q) => q.id === questionId)?.prompt ?? '';
  const questionResults = answers.map((a) => {
    const key = ANSWER_KEYS[a.questionId] ?? null;
    const isCorrect = key != null && normalizeAnswer(a.answerText) === normalizeAnswer(key);
    return {
      questionId: a.questionId,
      prompt: promptFor(a.questionId),
      accepted: isCorrect,
      score: isCorrect ? 100 : 0,
      feedbackSummary: null,
      validatorVersion: null,
      decisionHash: null,
      isCorrect,
      correctAnswer: key,
    };
  });
  const correct = questionResults.filter((r) => r.isCorrect).length;
  const total = Math.max(answers.length, 1);
  const score = Math.round((correct / total) * 100);
  return {
    lessonId,
    attemptId: body.attemptId,
    accepted: score >= 60,
    score,
    totalQuestions: answers.length,
    correctAnswers: correct,
    completedAt: FIXED_EPOCH.toISOString(),
    practiceMode: false,
    courseRuntime: cs ? { ...fpRuntimeSnapshot(cs), completedToday: true } : undefined,
    questionResults,
    xp: { xpAwarded: 50, xpTotal: 750, xpLevel: 2, levelThresholds: [0, 500, 1500] },
  };
}

/* ── Zustand courseStore seed (versioned wrapper per zustand/persist) ── */

function toStoreLesson(course: FpCourseSeed, lesson: FpLessonSeed) {
  return {
    id: lesson.id,
    courseId: course.id,
    moduleId: moduleIdFor(course.id),
    title: lesson.title,
    order: lesson.order,
    content: lesson.blocks.map((b) => b.text).join('\n\n'),
    blocks: lesson.blocks.map((b, i) => ({
      id: b.id,
      type: 'paragraph',
      order: i + 1,
      text: b.text,
    })),
    questions: lesson.questions.map((q) => ({
      id: q.id,
      type: 'mcq',
      prompt: q.prompt,
      options: q.options.map((o) => ({ id: o.id, text: o.text })),
      correctAnswer: undefined, // never in the payload — server grades
    })),
    version: 1,
    releaseId: FP_RELEASE_ID,
    contentHash: `hash-${lesson.id}`,
  };
}

export function fpCourseStoreSeed(s: FpScenario) {
  const enrolled = s.courses.filter((c) => c.enrolled);
  const enrolledIds = enrolled.map((c) => c.course.id);

  const lessonProgress = Object.fromEntries(
    enrolled.flatMap((c) =>
      c.completedLessonIds.map((lessonId) => [
        lessonId,
        {
          lessonId,
          courseId: c.course.id,
          completed: true,
          score: 100,
          completedAt: new Date(FIXED_EPOCH.getTime() - DAY_MS).toISOString(),
        },
      ]),
    ),
  );

  return {
    state: {
      courses: s.courses.map((c) => ({
        id: c.course.id,
        slug: c.course.id,
        title: c.course.title,
        description: c.course.description,
        totalLessons: c.course.lessons.length,
        completedLessons: c.completedLessonIds.length,
        totalModules: 1,
        difficulty: 'beginner',
        category: 'solana',
        publishedAt: new Date(FIXED_EPOCH.getTime() - 10 * DAY_MS).toISOString(),
        imageUrl: null,
        lockPolicy: { minPrincipalUi: '10', maxPrincipalUi: '50' },
      })),
      modules: Object.fromEntries(
        s.courses.map((c) => [c.course.id, fpModulesResponse(s, c.course.id)]),
      ),
      lessons: Object.fromEntries(
        s.courses.map((c) => [
          c.course.id,
          c.course.lessons.map((l) => toStoreLesson(c.course, l)),
        ]),
      ),
      lessonProgress,
      enrolledCourseIds: enrolledIds,
      activeCourseId: enrolledIds[0] ?? null,
      activeCourseIds: enrolledIds,
      courseStates: Object.fromEntries(
        enrolled.map((c) => [
          c.course.id,
          {
            lockAccountAddress:
              c.positionStatus === 'ACTIVE' || c.positionStatus === 'PENDING'
                ? FP_LOCK_ADDRESS
                : null,
            lockAmount: c.principalUi ? Number(c.principalUi) : 0,
            lockDuration: 30,
            extensionDays: 0,
            lockStartDate: new Date(FIXED_EPOCH.getTime() - 5 * DAY_MS).toISOString(),
            currentStreak: c.currentStreak,
            longestStreak: Math.max(c.currentStreak, 7),
            saverCount: 0,
            fuelCounter: 3,
            fuelCap: 7,
            fuelFragmentsToday: 0,
            ichorBalance: 0,
            shields: 3,
            lapseCount: 0,
            lapseOpen: false,
            consecutiveLessonDays: 1,
            completedToday: c.completedToday,
            dayEndsAtUtc: new Date(FIXED_EPOCH.getTime() + DAY_MS / 2).toISOString(),
            voucherAvailable: c.voucherAvailable,
          },
        ]),
      ),
      contentReleaseId: FP_RELEASE_ID,
      contentPublishedAt: new Date(FIXED_EPOCH.getTime() - 10 * DAY_MS).toISOString(),
      contentLoading: false,
      contentError: null,
      contentInitialized: true,
      boundWalletAddress: WALLET,
    },
    version: 1,
  };
}
