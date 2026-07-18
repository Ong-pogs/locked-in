import { test, expect } from '../fixtures/v2.fixture';

// Practice Hall gating: practice unlocks per COURSE — an in-progress course
// shows a locked card with N/M progress and NO lesson rows; only a fully
// completed course lists its lessons for stakes-free replay.

test.describe('practice hall — locked while the course is in progress', () => {
  test.use({ scenario: 'active' }); // 1 of 3 lessons complete
  test('shows the locked card with progress and no practice rows', async ({ v2Page: page }) => {
    await page.goto('/practice');
    await expect(page.locator('h1')).toHaveText('Practice Hall', { timeout: 20_000 });

    const locked = page.getByText('Finish the course to unlock practice');
    await expect(locked).toBeVisible();
    await expect(page.getByText('1/3 lessons done')).toBeVisible();
    // No lesson is replayable until the whole course is done.
    await expect(page.getByRole('button', { name: /^Practice / })).toHaveCount(0);
  });
});

test.describe('practice hall — completed course lists every lesson', () => {
  test.use({ scenario: 'practice' }); // 3 of 3 complete, lock CLOSED
  test('every completed lesson appears as a practice row', async ({ v2Page: page }) => {
    await page.goto('/practice');
    await expect(page.locator('h1')).toHaveText('Practice Hall', { timeout: 20_000 });

    await expect(page.getByText('Finish the course to unlock practice')).toHaveCount(0);
    for (const title of ['Introduction', 'Accounts', 'Transactions']) {
      await expect(page.getByRole('button', { name: `Practice ${title}` })).toBeVisible();
    }
  });
});
