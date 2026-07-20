import { test, expect } from '../fixtures/fullpass.fixture';
import { COURSE_A, COURSE_B, COURSE_C } from '../fixtures/fullpass-mocks';

// Courses page completed badge: a fully-completed course wears the
// "✓ Completed" tag; in-progress and untouched courses never do. The badge is
// recomputed from lessonProgress, so it survives claiming the stake (the
// settled course sits back in "Available" WITH the badge).

test.describe('happy: completed badge on the done course only', () => {
  test.use({ scenario: 'mixed' }); // A in progress (locked), B done+claimed, C untouched

  test('done course wears the badge; in-progress and untouched courses do not', async ({
    fpPage: page,
  }) => {
    await page.goto('/courses');

    // Post-onboarding layout: the locked course under Active, the rest under
    // Available.
    await expect(page.getByText('Active Courses')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Available Courses')).toBeVisible();
    await expect(page.getByText(COURSE_A.title)).toBeVisible();

    // The claimed-back course renders as an available card WITH the badge.
    const availableCards = page.locator('div[role="button"]');
    const doneCard = availableCards.filter({ hasText: COURSE_B.title });
    await expect(doneCard).toHaveCount(1);
    const badge = doneCard.getByTestId('course-completed-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('Completed');

    // The untouched course renders without one.
    const freshCard = availableCards.filter({ hasText: COURSE_C.title });
    await expect(freshCard).toHaveCount(1);
    await expect(freshCard.getByTestId('course-completed-badge')).toHaveCount(0);

    // Exactly ONE badge on the whole page — the in-progress active course
    // never grows one.
    await expect(page.getByTestId('course-completed-badge')).toHaveCount(1);
  });
});
