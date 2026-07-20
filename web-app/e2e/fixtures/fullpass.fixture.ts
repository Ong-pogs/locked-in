/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, expect as baseExpect, type Page } from '@playwright/test';
import { FIXED_EPOCH, userStoreSeed } from './v2-mocks';
import {
  ANSWER_KEYS,
  FP_RELEASE_ID,
  FP_LOCK_ADDRESS,
  FP_SCENARIOS,
  type FpPositionStatus,
  type FpScenarioKey,
  fpCourseStoreSeed,
  fpCoursesListResponse,
  fpEnrollmentsResponse,
  fpLessonsForModule,
  fpModulesResponse,
  fpPositionResponse,
  fpRuntimeSnapshot,
  fpVoucherResponse,
  gradeSubmission,
  normalizeAnswer,
  scenarioCourse,
  scenarioCourseForLesson,
} from './fullpass-mocks';

// Full-pass fixture. Composes the house rules from v2.fixture/content.fixture
// (cookies BEFORE first navigation, frozen clock, Privy blackholed, RPC
// aborted, external WebSockets closed, NO route catch-all) and adds:
//
// - a consistent multi-course catalog served from ONE scenario object, so
//   AppShell's unconditional content refetch replaces the store with
//   identical data instead of failing
// - the NEW recall-check endpoint (POST /v1/progress/lessons/:id/recall-check)
//   mocked with per-test overrides: recallCheckStatus (200|500) and
//   recallCheckDelayMs (holds the response so the `recall-checking` status
//   line is observable)
// - the check + submit endpoints graded from the fixture-side ANSWER_KEYS
//   (payloads never carry the key — production integrity contract)
// - a mutable FpApi handle for mid-test backend transitions (position 500s
//   healing for the Retry path; ACTIVE→CLOSED after a claim)

/** Shape the claim page persists to sessionStorage on success — seeding it
 * simulates "claimed earlier this session" for the dashboard's Claimed tab. */
export interface FpClaimReceiptSeed {
  signature: string;
  principalUi: string | null;
  receivedUi: string | null;
  bps: number;
  lapseCount: number;
  claimedAt: string;
}

export const claimReceiptKey = (courseId: string) => `locked-in-claim-success:${courseId}`;

/** Mid-test mock-backend control handle: flip what the "server" reports next. */
export interface FpApi {
  /** Next position GETs for the course report this status (e.g. CLOSED after a claim settles). */
  setPositionStatus(courseId: string, status: FpPositionStatus): void;
  /** 'fail' → every position GET 500s; 'ok' → scenario truth again. */
  setPositionMode(mode: 'ok' | 'fail'): void;
  /** How many position GETs the mock has served for the course. Lets a test
   * wait out the app's boot-time poll burst before flipping the mode, so a
   * late boot poll can never heal the card mid-click. */
  positionRequests(courseId: string): number;
}

class FpApiState implements FpApi {
  positionMode: 'ok' | 'fail' = 'ok';
  readonly positionStatusOverride = new Map<string, FpPositionStatus>();
  readonly positionHits = new Map<string, number>();
  setPositionStatus(courseId: string, status: FpPositionStatus): void {
    this.positionStatusOverride.set(courseId, status);
  }
  setPositionMode(mode: 'ok' | 'fail'): void {
    this.positionMode = mode;
  }
  positionRequests(courseId: string): number {
    return this.positionHits.get(courseId) ?? 0;
  }
}

interface FullpassFixtures {
  fpPage: Page;
  fpApi: FpApi;
  unmatchedRequests: string[];
  // per-describe options (test.use)
  scenario: FpScenarioKey;
  recallCheckStatus: 200 | 500;
  recallCheckDelayMs: number;
  quizCheckStatus: 200 | 500;
  voucherMode: 'ok' | 403 | 'expired';
  positionMode: 'ok' | 'fail';
  claimReceipts: Record<string, FpClaimReceiptSeed>;
}

export const test = base.extend<FullpassFixtures>({
  scenario: ['learning', { option: true }],
  recallCheckStatus: [200, { option: true }],
  recallCheckDelayMs: [0, { option: true }],
  quizCheckStatus: [200, { option: true }],
  voucherMode: ['ok', { option: true }],
  positionMode: ['ok', { option: true }],
  claimReceipts: [{}, { option: true }],

  unmatchedRequests: async ({}, use) => {
    await use([]);
  },

  fpApi: async ({ positionMode }, use) => {
    const api = new FpApiState();
    api.positionMode = positionMode;
    await use(api);
  },

  fpPage: async (
    {
      page,
      context,
      baseURL,
      scenario,
      fpApi,
      recallCheckStatus,
      recallCheckDelayMs,
      quizCheckStatus,
      voucherMode,
      claimReceipts,
      unmatchedRequests,
    },
    use,
  ) => {
    const apiState = fpApi as FpApiState;
    const s = FP_SCENARIOS[scenario];
    const url = baseURL ?? 'http://localhost:3000';

    // 1. Auth cookies BEFORE first navigation (domain+path form — the { url }
    //    form does not attach to the edge middleware's first request, so a
    //    deep-linked /lessons or /claim would 307 to /village).
    const host = new URL(url).hostname;
    await context.addCookies([
      { name: 'locked-in-auth', value: '1', domain: host, path: '/' },
      { name: 'locked-in-tutorial-done', value: '1', domain: host, path: '/' },
    ]);

    // 2. Fixed Date (timers stay live — clock.install would stall the shell).
    await page.clock.setFixedTime(FIXED_EPOCH);

    // 3. Seed Zustand stores + splash skip + claim receipts + tx stub.
    await page.addInitScript(
      (data) => {
        sessionStorage.setItem('splash-shown', '1');
        localStorage.setItem('locked-in-user', JSON.stringify(data.userState));
        localStorage.setItem('locked-in-courses', JSON.stringify(data.courseState));
        localStorage.setItem('locked-in-tutorial-done', '1');
        for (const [key, value] of data.receiptEntries) {
          sessionStorage.setItem(key, value);
        }
        // e2e tx stub (active only with NEXT_PUBLIC_E2E_TX_STUB=1 build + localhost)
        (window as unknown as Record<string, unknown>).__lockedInTxStub = {
          execute: async (kind: string) => ({
            signature: `E2E_STUB_SIG_${kind}_1111111111111111111111111111111111`,
            receivedUi: kind === 'claim' ? '51.2130' : null,
            lockAddress: kind === 'deposit' ? data.lockAddress : undefined,
          }),
        };
      },
      {
        userState: userStoreSeed(),
        courseState: fpCourseStoreSeed(s),
        receiptEntries: Object.entries(claimReceipts).map(([courseId, receipt]) => [
          claimReceiptKey(courseId),
          JSON.stringify(receipt),
        ]),
        lockAddress: FP_LOCK_ADDRESS,
      },
    );

    // 4. Privy: hold in loading forever (house pattern — prevents the auth
    //    cleanup effect from wiping seeded state).
    await page.route('**/api.privy.io/**', () => {
      /* never respond */
    });

    // 5. Solana RPC: abort. External WebSockets: close (localhost HMR stays).
    await page.route('**/api.devnet.solana.com/**', (route) => route.abort());
    await page.route('**/e2e-rpc.invalid/**', (route) => route.abort());
    await page.routeWebSocket(
      (wsUrl) => !wsUrl.href.includes('localhost') && !wsUrl.href.includes('127.0.0.1'),
      (ws) => ws.close(),
    );

    // 6. Backend mocks — explicit per endpoint, generated from the scenario.
    //    Every fulfill carries CORS headers (app origin 3200 ≠ API 3001).
    const CORS = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'access-control-allow-headers': 'authorization,content-type',
    };
    const json = (body: unknown, status = 200) => ({
      status,
      contentType: 'application/json',
      headers: CORS,
      body: JSON.stringify(body),
    });

    await page.route('**/localhost:3001/**', async (route) => {
      const reqUrl = route.request().url();
      const method = route.request().method();
      const path = new URL(reqUrl).pathname;

      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      if (path.includes('/health')) return route.fulfill(json({ ok: true }));

      // ── Catalog (identical to the store seed, so the boot refetch is a no-op) ──
      if (path === '/v1/content/version') {
        return route.fulfill(
          json({
            releaseId: FP_RELEASE_ID,
            publishedAt: new Date(FIXED_EPOCH.getTime() - 10 * 24 * 3600 * 1000).toISOString(),
          }),
        );
      }
      const modulesMatch = path.match(/^\/v1\/courses\/([^/]+)\/modules$/);
      if (modulesMatch) return route.fulfill(json(fpModulesResponse(s, modulesMatch[1])));
      const moduleLessonsMatch = path.match(/^\/v1\/modules\/([^/]+)\/lessons$/);
      if (moduleLessonsMatch)
        return route.fulfill(json(fpLessonsForModule(s, moduleLessonsMatch[1])));
      if (path === '/v1/courses') return route.fulfill(json(fpCoursesListResponse(s)));

      // ── Progress ──
      if (path === '/v1/progress/enrollments')
        return route.fulfill(json(fpEnrollmentsResponse(s)));
      const runtimeMatch = path.match(/^\/v1\/progress\/runtime\/courses\/([^/]+)$/);
      if (runtimeMatch) {
        const cs = scenarioCourse(s, runtimeMatch[1]);
        if (!cs) return route.fulfill(json({ message: 'Not enrolled' }, 404));
        return route.fulfill(json(fpRuntimeSnapshot(cs)));
      }
      const startMatch = path.match(/^\/v1\/progress\/lessons\/([^/]+)\/start$/);
      if (startMatch && method === 'POST') {
        const body = route.request().postDataJSON() as {
          attemptId: string;
          startedAt: string;
        };
        return route.fulfill(
          json({ lessonId: startMatch[1], attemptId: body.attemptId, startedAt: body.startedAt }),
        );
      }

      // ── NEW: stateless recall verdict (nothing locked, no attempt) ──
      const recallMatch = path.match(/^\/v1\/progress\/lessons\/([^/]+)\/recall-check$/);
      if (recallMatch && method === 'POST') {
        // Optional hold so the transient `recall-checking` status line is
        // observable in the UI (assertions still event-driven, never timed).
        if (recallCheckDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, recallCheckDelayMs));
        }
        if (recallCheckStatus !== 200) {
          return route.fulfill(json({ message: 'Recall check unavailable' }, recallCheckStatus));
        }
        const body = route.request().postDataJSON() as {
          questionId: string;
          answerText: string;
        };
        const key = ANSWER_KEYS[body.questionId];
        if (!key) {
          return route.fulfill(json({ message: `Unknown question ${body.questionId}` }, 404));
        }
        return route.fulfill(
          json({
            questionId: body.questionId,
            isCorrect: normalizeAnswer(body.answerText) === normalizeAnswer(key),
            correctAnswer: key,
          }),
        );
      }

      // ── Instant per-question check (locks the answer, reveals the key) ──
      const checkMatch = path.match(/^\/v1\/progress\/lessons\/([^/]+)\/check$/);
      if (checkMatch && method === 'POST') {
        if (quizCheckStatus !== 200) {
          return route.fulfill(json({ message: 'Check unavailable' }, quizCheckStatus));
        }
        const body = route.request().postDataJSON() as {
          attemptId: string;
          questionId: string;
          answerText: string;
        };
        const key = ANSWER_KEYS[body.questionId] ?? null;
        const isCorrect =
          key != null && normalizeAnswer(body.answerText) === normalizeAnswer(key);
        return route.fulfill(
          json({
            questionId: body.questionId,
            locked: false,
            lockedAnswerText: body.answerText,
            isCorrect,
            questionScore: isCorrect ? 100 : 0,
            correctAnswer: key,
          }),
        );
      }

      const submitMatch = path.match(/^\/v1\/progress\/lessons\/([^/]+)\/submit$/);
      if (submitMatch && method === 'POST') {
        const body = route.request().postDataJSON() as {
          attemptId: string;
          answers?: { questionId: string; answerText: string }[];
        };
        const cs = scenarioCourseForLesson(s, submitMatch[1]);
        return route.fulfill(json(gradeSubmission(submitMatch[1], body, cs)));
      }

      // ── Locks ──
      const positionMatch = path.match(/^\/v1\/locks\/([^/]+)\/position$/);
      if (positionMatch) {
        const courseId = positionMatch[1];
        apiState.positionHits.set(courseId, (apiState.positionHits.get(courseId) ?? 0) + 1);
        if (apiState.positionMode === 'fail') {
          return route.fulfill(json({ message: 'Position backend unavailable' }, 500));
        }
        return route.fulfill(
          json(
            fpPositionResponse(
              courseId,
              scenarioCourse(s, courseId),
              apiState.positionStatusOverride.get(courseId),
            ),
          ),
        );
      }
      const eligibilityMatch = path.match(/^\/v1\/locks\/([^/]+)\/eligibility$/);
      if (eligibilityMatch) {
        const cs = scenarioCourse(s, eligibilityMatch[1]);
        const complete =
          cs != null && cs.completedLessonIds.length >= cs.course.lessons.length;
        return route.fulfill(
          json(complete ? { eligible: false, code: 'COURSE_COMPLETED' } : { eligible: true }),
        );
      }
      const voucherMatch = path.match(/^\/v1\/progress\/courses\/([^/]+)\/voucher$/);
      if (voucherMatch && method === 'POST') {
        if (voucherMode === 403) {
          return route.fulfill(
            json({ message: 'Course not yet complete', code: 'COURSE_NOT_COMPLETE' }, 403),
          );
        }
        return route.fulfill(
          json(fpVoucherResponse(voucherMatch[1], voucherMode === 'expired')),
        );
      }

      // ── Misc dashboard chrome ──
      if (path === '/v1/progress/xp')
        return route.fulfill(json({ xpTotal: 700, xpLevel: 2, levelThresholds: [0, 500, 1500] }));
      if (path === '/v1/yield/current-apy')
        return route.fulfill(json({ apyPct: 8, source: 'fixed_apy' }));

      // NO catch-all: record + 404 so a missing mock is loud, not silent.
      unmatchedRequests.push(`${method} ${reqUrl}`);
      return route.fulfill({ status: 404, contentType: 'application/json', headers: CORS, body: '{}' });
    });

    await use(page);
  },
});

export const expect = baseExpect;
