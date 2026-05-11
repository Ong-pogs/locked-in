import { test, expect } from '@playwright/test';
import { CoursesPage } from '../pages/courses.page';

/**
 * Courses page tests — public page, no auth required.
 * Tests that the course listing renders correctly.
 */

function setupMocks(page: import('@playwright/test').Page) {
  return Promise.all([
    page.addInitScript(() => {
      sessionStorage.setItem('splash-shown', '1');
    }),
    page.route('**/localhost:3001/**', (route) => {
      const url = route.request().url();
      if (url.includes('/v1/content/version')) {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ releaseId: '1' }) });
      } else if (url.includes('/v1/courses')) {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            { id: 'solana-101', title: 'Solana 101', description: 'Learn Solana fundamentals', totalLessons: 10, totalModules: 3, difficulty: 'beginner', category: 'solana' },
            { id: 'defi-201', title: 'DeFi Fundamentals', description: 'Understand decentralized finance', totalLessons: 8, totalModules: 2, difficulty: 'intermediate', category: 'defi' },
          ]),
        });
      } else {
        route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
    }),
    // Keep Privy in loading state
    page.route('**/api.privy.io/**', () => {}),
  ]);
}

test.describe('Courses page', () => {
  test('loads and shows page heading', async ({ page }) => {
    await setupMocks(page);

    const coursesPage = new CoursesPage(page);
    await coursesPage.goto();
    await coursesPage.waitForContent();

    // Post-pivot heading is just "Courses" (was "Choose Your Path")
    const heading = await coursesPage.heading.textContent();
    expect(heading).toContain('Courses');
  });

  test('shows Sign In button for unauthenticated users', async ({ page }) => {
    await setupMocks(page);

    const coursesPage = new CoursesPage(page);
    await coursesPage.goto();
    await coursesPage.waitForContent();

    await expect(coursesPage.signInButton).toBeVisible();
  });

  test('displays course cards with title and description', async ({ page }) => {
    await setupMocks(page);

    // Seed course data via localStorage
    const courseState = {
      state: {
        courses: [
          { id: 'solana-101', title: 'Solana 101', description: 'Learn the fundamentals of Solana development', totalLessons: 10, totalModules: 3, difficulty: 'beginner', category: 'solana', completedLessons: 0 },
          { id: 'defi-201', title: 'DeFi Fundamentals', description: 'Understand decentralized finance protocols', totalLessons: 8, totalModules: 2, difficulty: 'intermediate', category: 'defi', completedLessons: 0 },
        ],
        modules: {},
        lessons: {},
        lessonProgress: {},
        enrolledCourseIds: [],
        activeCourseId: null,
        activeCourseIds: [],
        courseStates: {},
        contentReleaseId: '1',
        contentPublishedAt: '2025-01-01T00:00:00.000Z',
        contentLoading: false,
        contentError: null,
        contentInitialized: true,
        boundWalletAddress: null,
      },
      version: 0,
    };

    await page.addInitScript((data) => {
      localStorage.setItem('locked-in-courses', JSON.stringify(data));
    }, courseState);

    const coursesPage = new CoursesPage(page);
    await coursesPage.goto();
    await coursesPage.waitForContent();

    // Should display course titles
    await expect(page.getByText('Solana 101')).toBeVisible({ timeout: 10_000 });
  });

  test('shows difficulty and category tags', async ({ page }) => {
    await setupMocks(page);

    const courseState = {
      state: {
        courses: [
          { id: 'solana-101', title: 'Solana 101', description: 'Learn Solana', totalLessons: 10, totalModules: 1, difficulty: 'beginner', category: 'solana', completedLessons: 0 },
        ],
        modules: {},
        lessons: {},
        lessonProgress: {},
        enrolledCourseIds: [],
        activeCourseId: null,
        activeCourseIds: [],
        courseStates: {},
        contentReleaseId: '1',
        contentPublishedAt: null,
        contentLoading: false,
        contentError: null,
        contentInitialized: true,
        boundWalletAddress: null,
      },
      version: 0,
    };

    await page.addInitScript((data) => {
      localStorage.setItem('locked-in-courses', JSON.stringify(data));
    }, courseState);

    await page.goto('/courses');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // Tags rendered as badge spans with uppercase tracking and bold styling
    // Use .first() since "beginner" appears in both the badge tag and the footer
    await expect(page.getByText('beginner').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('solana').first()).toBeVisible({ timeout: 10_000 });
  });
});
