/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, expect as baseExpect, type Page } from '@playwright/test';
import {
  COURSE_ID,
  FIXED_EPOCH,
  SCENARIOS,
  type ScenarioKey,
  courseStoreSeed,
  coursesListResponse,
  enrollmentsResponse,
  positionResponse,
  runtimeSnapshot,
  userStoreSeed,
  voucherResponse,
} from './v2-mocks';

// Self-contained v2 fixture (does NOT import auth.fixture — debate ruling):
// - cookies via context.addCookies BEFORE first navigation (deep links would
//   otherwise 307 to /village at the edge proxy)
// - Zustand seeds + route mocks generated from ONE scenario object
// - Privy blackholed (never resolves), Solana RPC aborted, WebSockets closed
// - NO '{}' catch-all: unmatched backend calls 404 and are recorded; specs
//   can assert none happened
// - frozen clock at FIXED_EPOCH before navigation

interface V2Fixtures {
  v2Page: Page;
  scenario: ScenarioKey;
  unmatchedRequests: string[];
  voucherStatus: number; // POST voucher mock: 200 | 403 | 503
}

export const test = base.extend<V2Fixtures>({
  scenario: ['active', { option: true }],
  voucherStatus: [200, { option: true }],
  unmatchedRequests: async ({}, use) => {
    await use([]);
  },

  v2Page: async ({ page, context, baseURL, scenario, voucherStatus, unmatchedRequests }, use) => {
    const s = SCENARIOS[scenario];
    const url = baseURL ?? 'http://localhost:3000';

    // 1. Auth cookies BEFORE first navigation. Must use domain+path, NOT
    //    { url } — the { url } form does not attach to the edge middleware's
    //    first request, so a deep-linked /claim would 307 to /village.
    const host = new URL(url).hostname;
    await context.addCookies([
      { name: 'locked-in-auth', value: '1', domain: host, path: '/' },
      { name: 'locked-in-tutorial-done', value: '1', domain: host, path: '/' },
    ]);

    // 2. Fixed Date (timers stay live — clock.install would freeze every
    //    setTimeout and stall the app shell; visual specs pause separately).
    await page.clock.setFixedTime(FIXED_EPOCH);

    // 3. Seed Zustand stores + splash skip + tx stub.
    await page.addInitScript(
      (data) => {
        sessionStorage.setItem('splash-shown', '1');
        localStorage.setItem('locked-in-user', JSON.stringify(data.userState));
        localStorage.setItem('locked-in-courses', JSON.stringify(data.courseState));
        localStorage.setItem('locked-in-tutorial-done', '1');
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
        courseState: courseStoreSeed(s),
        lockAddress: '6czu6E4765JzjVESkErbDrdXrdXf3xLWsYfSsBKYnhJb',
      },
    );

    // 4. Privy: hold in loading forever (house pattern — prevents the auth
    //    cleanup effect from wiping seeded state).
    await page.route('**/api.privy.io/**', () => {
      /* never respond */
    });

    // 5. Solana RPC: abort. External WebSockets: close (the localhost HMR
    //    socket must stay — closing it blanks the Next dev page entirely).
    await page.route('**/api.devnet.solana.com/**', (route) => route.abort());
    await page.route('**/e2e-rpc.invalid/**', (route) => route.abort());
    await page.routeWebSocket(
      (wsUrl) => !wsUrl.href.includes('localhost') && !wsUrl.href.includes('127.0.0.1'),
      (ws) => ws.close(),
    );

    // 6. Backend mocks — explicit per endpoint, generated from the scenario.
    //    Every fulfill carries CORS headers: the app origin (3200) differs
    //    from the API origin (3001), and Authorization triggers preflights.
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

    await page.route('**/localhost:3001/**', (route) => {
      const reqUrl = route.request().url();
      const method = route.request().method();

      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      if (reqUrl.includes('/health')) return route.fulfill(json({ ok: true }));
      if (reqUrl.includes('/v1/content/version')) return route.fulfill(json({ releaseId: '1' }));
      if (reqUrl.includes('/v1/courses') && !reqUrl.includes('/modules'))
        return route.fulfill(json(coursesListResponse()));
      if (reqUrl.includes('/v1/progress/enrollments'))
        return route.fulfill(json(enrollmentsResponse(s)));
      if (reqUrl.includes(`/v1/progress/runtime/courses/${COURSE_ID}`))
        return route.fulfill(json(runtimeSnapshot(s)));
      if (reqUrl.includes(`/v1/locks/${COURSE_ID}/position`))
        return route.fulfill(json(positionResponse(s)));
      // Eligibility pre-gate: completed-course scenarios are ineligible
      // (relock blocked forever); everything else may lock.
      if (reqUrl.includes(`/v1/locks/${COURSE_ID}/eligibility`)) {
        const complete = s.completedLessons >= 3;
        return route.fulfill(
          json(complete ? { eligible: false, code: 'COURSE_COMPLETED' } : { eligible: true }),
        );
      }
      if (method === 'POST' && reqUrl.includes(`/v1/locks/${COURSE_ID}/enroll`))
        return route.fulfill(
          json({ enrolled: true, courseId: COURSE_ID, lockAddress: positionResponse(s).lockAddress, principalUi: s.principalUi, status: 'ACTIVE' }),
        );
      if (method === 'POST' && reqUrl.includes(`/v1/progress/courses/${COURSE_ID}/voucher`)) {
        if (voucherStatus === 200) return route.fulfill(json(voucherResponse(s)));
        return route.fulfill({
          status: voucherStatus,
          contentType: 'application/json',
          headers: CORS,
          body: JSON.stringify({
            message: voucherStatus === 403 ? 'Course not yet complete' : 'Voucher signing is not configured',
            code: voucherStatus === 403 ? 'COURSE_NOT_COMPLETE' : 'VOUCHER_SIGNING_UNCONFIGURED',
          }),
        });
      }
      if (reqUrl.includes('/v1/progress/xp'))
        return route.fulfill(json({ xpTotal: 700, xpLevel: 2, levelThresholds: [0, 500, 1500] }));
      if (reqUrl.includes('/v1/yield/current-apy'))
        return route.fulfill(json({ apyPct: 5.2, source: 'mock' }));

      // NO catch-all: record + 404 so a missing mock is loud, not silent.
      unmatchedRequests.push(`${method} ${reqUrl}`);
      return route.fulfill({ status: 404, contentType: 'application/json', headers: CORS, body: '{}' });
    });

    await use(page);
  },
});

export const expect = baseExpect;
