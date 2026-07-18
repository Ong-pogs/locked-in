/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, expect as baseExpect, type Page } from '@playwright/test';
import { FIXED_EPOCH, userStoreSeed, WALLET } from './v2-mocks';
import snapshotJson from './content-snapshot.json';

// Content-verification fixture. Follows the v2.fixture house rules (cookies
// before navigation, Privy blackholed, RPC aborted, frozen clock, NO route
// catch-all) but seeds the WHOLE real catalog from content-snapshot.json:
//
// - the course store is pre-hydrated with every seeded course + full lesson
//   payloads (blocks + questions), mapped exactly like
//   services/repositories/contentRepository.toLesson
// - the catalog API (/v1/courses, /modules, /lessons, /content/version) is
//   mocked from the SAME snapshot, so AppShell's unconditional content
//   refetch replaces the store with identical data instead of failing
// - every lesson is marked completed (practice replay) so any lesson deep
//   link passes the progression gate deterministically
// - the per-question check endpoint is mocked (the real payloads carry no
//   answer key — the new check-to-lock quiz flow needs the server verdict)

/* ── Snapshot types (shape of e2e/fixtures/content-snapshot.json) ── */

export interface SnapshotBlock {
  id: string;
  type: string;
  order: number;
  text?: string;
  language?: string;
  calloutTone?: string;
  caption?: string;
  imageUrl?: string;
  variant?: string;
  title?: string;
  steps?: { title: string; desc: string; icon?: string | null; color?: string }[];
  items?: unknown[];
  chains?: { name: string; tagline: string; desc: string; stats: string[]; theme: string }[];
  headers?: string[];
  rows?: string[][];
  highlightRow?: number | null;
  number?: number;
  example?: string;
  exampleSender?: string;
  rule?: string;
}

export interface SnapshotQuestion {
  id: string;
  type: 'mcq' | 'short_text';
  prompt: string;
  options?: { id: string; text: string }[];
}

export interface SnapshotLesson {
  id: string;
  courseId: string;
  moduleId: string;
  order: number;
  title: string;
  blocks: SnapshotBlock[];
  questions: SnapshotQuestion[];
  version: number;
  releaseId: string;
  contentHash: string;
}

interface SnapshotCourse {
  id: string;
  slug: string;
  title: string;
  description: string;
  difficulty: string;
  category: string;
  imageUrl: string | null;
  totalModules: number;
  totalLessons: number;
  lockPolicy: Record<string, unknown>;
  publishedAt: string;
}

interface SnapshotModule {
  id: string;
  courseId: string;
  slug: string;
  title: string;
  description: string;
  order: number;
  difficulty: string;
  totalLessons: number;
  estimatedMinutes: number;
}

interface ContentSnapshot {
  source: string;
  generatedAt: string;
  releaseId: string;
  publishedAt: string;
  courses: SnapshotCourse[];
  modulesByCourse: Record<string, SnapshotModule[]>;
  lessonsByModule: Record<string, SnapshotLesson[]>;
}

export const SNAPSHOT = snapshotJson as unknown as ContentSnapshot;

/* ── Enumeration helpers (used by the spec to parameterize tests) ── */

export function allLessons(): SnapshotLesson[] {
  return Object.values(SNAPSHOT.lessonsByModule)
    .flat()
    .sort((a, b) => (a.courseId === b.courseId ? a.order - b.order : a.courseId.localeCompare(b.courseId)));
}

export function lessonsForCourse(courseId: string): SnapshotLesson[] {
  return allLessons().filter((l) => l.courseId === courseId);
}

/** Courses that actually carry seeded lessons. */
export function contentCourses(): SnapshotCourse[] {
  return SNAPSHOT.courses.filter((c) => lessonsForCourse(c.id).length > 0);
}

/**
 * The lesson page shows the spaced-recall interstitial when ANY earlier
 * completed lesson in the course has questions. All lessons are seeded
 * complete, so this is fully determined by the snapshot.
 */
export function expectsRecall(lesson: SnapshotLesson): boolean {
  return lessonsForCourse(lesson.courseId).some(
    (l) => l.order < lesson.order && l.questions.length > 0,
  );
}

/* ── Store seeds ── */

// Mirrors contentRepository.toLesson (blocks passthrough, options {id,text},
// content = joined block texts) so the pre-hydrated store matches what the
// real catalog sync writes.
function toStoreLesson(l: SnapshotLesson) {
  const blocks = [...l.blocks].sort((a, b) => a.order - b.order);
  return {
    id: l.id,
    courseId: l.courseId,
    moduleId: l.moduleId,
    title: l.title,
    order: l.order,
    content: blocks.map((b) => b.text ?? '').filter(Boolean).join('\n\n'),
    blocks,
    questions: l.questions.map((q) => ({
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      options: q.options?.map((o) => ({ id: o.id, text: o.text })),
      correctAnswer: undefined,
    })),
    version: l.version,
    releaseId: l.releaseId,
    contentHash: l.contentHash,
  };
}

function contentCourseStoreSeed() {
  const courses = SNAPSHOT.courses.map((c) => {
    const count = lessonsForCourse(c.id).length;
    return {
      id: c.id,
      slug: c.slug,
      title: c.title,
      description: c.description,
      totalLessons: c.totalLessons,
      completedLessons: count, // every seeded lesson completed
      totalModules: c.totalModules,
      difficulty: c.difficulty,
      category: c.category,
      publishedAt: c.publishedAt,
      imageUrl: c.imageUrl,
      lockPolicy: c.lockPolicy,
    };
  });

  const lessons = Object.fromEntries(
    contentCourses().map((c) => [c.id, lessonsForCourse(c.id).map(toStoreLesson)]),
  );

  const lessonProgress = Object.fromEntries(
    allLessons().map((l) => [
      l.id,
      {
        lessonId: l.id,
        courseId: l.courseId,
        completed: true,
        score: 100,
        completedAt: new Date(FIXED_EPOCH.getTime() - 24 * 3600 * 1000).toISOString(),
      },
    ]),
  );

  const enrolledIds = contentCourses().map((c) => c.id);

  return {
    state: {
      courses,
      modules: SNAPSHOT.modulesByCourse,
      lessons,
      lessonProgress,
      enrolledCourseIds: enrolledIds,
      activeCourseId: enrolledIds[0] ?? null,
      activeCourseIds: enrolledIds,
      courseStates: {},
      contentReleaseId: SNAPSHOT.releaseId,
      contentPublishedAt: SNAPSHOT.publishedAt,
      contentLoading: false,
      contentError: null,
      contentInitialized: true,
      boundWalletAddress: WALLET,
    },
    version: 1,
  };
}

/* ── Fixture ── */

interface ContentFixtures {
  contentPage: Page;
  unmatchedRequests: string[];
}

export const test = base.extend<ContentFixtures>({
  unmatchedRequests: async ({}, use) => {
    await use([]);
  },

  contentPage: async ({ page, context, baseURL, unmatchedRequests }, use) => {
    const url = baseURL ?? 'http://localhost:3000';

    // 1. Auth cookies BEFORE first navigation (edge proxy 307s deep links
    //    without them). domain+path form, per the v2.fixture ruling.
    const host = new URL(url).hostname;
    await context.addCookies([
      { name: 'locked-in-auth', value: '1', domain: host, path: '/' },
      { name: 'locked-in-tutorial-done', value: '1', domain: host, path: '/' },
    ]);

    // 2. Frozen clock (timers stay live).
    await page.clock.setFixedTime(FIXED_EPOCH);

    // 3. Seed Zustand stores + splash skip.
    await page.addInitScript(
      (data) => {
        sessionStorage.setItem('splash-shown', '1');
        localStorage.setItem('locked-in-user', JSON.stringify(data.userState));
        localStorage.setItem('locked-in-courses', JSON.stringify(data.courseState));
        localStorage.setItem('locked-in-tutorial-done', '1');
      },
      { userState: userStoreSeed(), courseState: contentCourseStoreSeed() },
    );

    // 4. Privy: hold in loading forever (house pattern).
    await page.route('**/api.privy.io/**', () => {
      /* never respond */
    });

    // 5. Solana RPC aborted; external WebSockets closed.
    await page.route('**/api.devnet.solana.com/**', (route) => route.abort());
    await page.route('**/e2e-rpc.invalid/**', (route) => route.abort());
    await page.routeWebSocket(
      (wsUrl) => !wsUrl.href.includes('localhost') && !wsUrl.href.includes('127.0.0.1'),
      (ws) => ws.close(),
    );

    // 6. Backend mocks. CORS on every response (app origin 3200 ≠ API 3001).
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
      const path = new URL(reqUrl).pathname;

      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      if (path.includes('/health')) return route.fulfill(json({ ok: true }));

      // Catalog — straight from the snapshot (AppShell refetches the whole
      // catalog on boot; serving identical data keeps the store stable).
      if (path === '/v1/content/version')
        return route.fulfill(json({ releaseId: SNAPSHOT.releaseId, publishedAt: SNAPSHOT.publishedAt }));
      const modulesMatch = path.match(/^\/v1\/courses\/([^/]+)\/modules$/);
      if (modulesMatch)
        return route.fulfill(json(SNAPSHOT.modulesByCourse[modulesMatch[1]] ?? []));
      const lessonsMatch = path.match(/^\/v1\/modules\/([^/]+)\/lessons$/);
      if (lessonsMatch)
        return route.fulfill(json(SNAPSHOT.lessonsByModule[lessonsMatch[1]] ?? []));
      if (path === '/v1/courses') return route.fulfill(json(SNAPSHOT.courses));

      // Progress — background sync + the lesson attempt endpoints.
      if (path === '/v1/progress/enrollments')
        return route.fulfill(
          json({
            enrollments: [],
            lessonProgress: allLessons().map((l) => ({
              lessonId: l.id,
              completed: true,
              score: 100,
              completedAt: new Date(FIXED_EPOCH.getTime() - 24 * 3600 * 1000).toISOString(),
            })),
          }),
        );
      const startMatch = path.match(/^\/v1\/progress\/lessons\/([^/]+)\/start$/);
      if (startMatch && method === 'POST') {
        const body = route.request().postDataJSON() as { attemptId: string; startedAt: string };
        return route.fulfill(
          json({ lessonId: startMatch[1], attemptId: body.attemptId, startedAt: body.startedAt }),
        );
      }
      // Instant per-question check: lock the submitted answer, report it
      // correct (the walk only needs a deterministic verdict to advance).
      const checkMatch = path.match(/^\/v1\/progress\/lessons\/([^/]+)\/check$/);
      if (checkMatch && method === 'POST') {
        const body = route.request().postDataJSON() as {
          attemptId: string;
          questionId: string;
          answerText: string;
        };
        return route.fulfill(
          json({
            questionId: body.questionId,
            locked: false,
            lockedAnswerText: body.answerText,
            isCorrect: true,
            questionScore: 100,
            correctAnswer: null,
          }),
        );
      }
      if (path === '/v1/progress/xp')
        return route.fulfill(json({ xpTotal: 700, xpLevel: 2, levelThresholds: [0, 500, 1500] }));
      if (path === '/v1/yield/current-apy')
        return route.fulfill(json({ apyPct: 5.2, source: 'mock' }));

      // NO catch-all: record + 404 so a missing mock is loud, not silent.
      unmatchedRequests.push(`${method} ${reqUrl}`);
      return route.fulfill({ status: 404, contentType: 'application/json', headers: CORS, body: '{}' });
    });

    await use(page);
  },
});

export const expect = baseExpect;
