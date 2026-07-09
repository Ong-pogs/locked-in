import { test, expect } from '../fixtures/v2.fixture';
import { COURSE_ID } from '../fixtures/v2-mocks';

// Visual baselines for the v2 money surfaces (spec §5). Each shot is preceded by
// functional expects (pixels guard aesthetics; expects guard data) and the
// ticking position value is masked so accrual can't churn the baseline. No
// fullPage — theme background-attachment:fixed banding makes full-page unstable.

async function settle(page: import('@playwright/test').Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.fonts.ready);
}

test.describe('dashboard card states', () => {
  test.use({ scenario: 'active' });
  test('active / blazing', async ({ v2Page: page }) => {
    await page.goto('/dashboard');
    const card = page.getByTestId('v2-position-card');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('v2-flame-gauge')).toHaveAttribute('data-state', 'blazing');
    await settle(page);
    await expect(card).toHaveScreenshot('card-active.png', {
      mask: [page.getByTestId('v2-position-value')],
    });
  });
});

test.describe('dashboard card — lapsed', () => {
  test.use({ scenario: 'lapsedOne' });
  test('dark / penalty', async ({ v2Page: page }) => {
    await page.goto('/dashboard');
    const card = page.getByTestId('v2-position-card');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('v2-penalty-banner')).toContainText('50%');
    await settle(page);
    await expect(card).toHaveScreenshot('card-lapsed.png', {
      mask: [page.getByTestId('v2-position-value')],
    });
  });
});

test.describe('dashboard card — claimable', () => {
  test.use({ scenario: 'claimable' });
  test('CLAIM armed', async ({ v2Page: page }) => {
    await page.goto('/dashboard');
    const card = page.getByTestId('v2-position-card');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('v2-claim-cta')).toBeVisible();
    await settle(page);
    await expect(card).toHaveScreenshot('card-claimable.png', {
      mask: [page.getByTestId('v2-position-value')],
    });
  });
});

test.describe('claim review', () => {
  test.use({ scenario: 'claimable' });
  test('review breakdown', async ({ v2Page: page }) => {
    await page.goto(`/claim/${COURSE_ID}`);
    const review = page.getByTestId('v2-claim-review');
    await expect(review).toBeVisible({ timeout: 20_000 });
    await expect(review).toContainText('100%');
    await settle(page);
    await expect(review).toHaveScreenshot('claim-review.png');
  });

  test('claim success breakdown', async ({ v2Page: page }) => {
    await page.goto(`/claim/${COURSE_ID}`);
    await expect(page.getByTestId('v2-claim-review')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('v2-claim-submit').click();
    const success = page.getByTestId('v2-claim-success');
    await expect(success).toBeVisible({ timeout: 15_000 });
    await settle(page);
    await expect(success).toHaveScreenshot('claim-success.png', {
      // tx signature line is deterministic (stub) but mask defensively
      mask: [],
    });
  });
});

test.describe('claim penalty review', () => {
  test.use({ scenario: 'lapsedOne' });
  test('50/50 review with banner', async ({ v2Page: page }) => {
    await page.goto(`/claim/${COURSE_ID}`);
    const review = page.getByTestId('v2-claim-review');
    await expect(review).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('v2-penalty-banner')).toBeVisible();
    await settle(page);
    await expect(review).toHaveScreenshot('claim-review-penalty.png');
  });
});

test.describe('deposit form', () => {
  test.use({ scenario: 'active' });
  test('v2 deposit', async ({ v2Page: page }) => {
    await page.goto(`/onboarding/deposit?courseId=${COURSE_ID}`);
    const form = page.getByTestId('v2-deposit-form');
    await expect(form).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('v2-capacity-meter')).toBeVisible();
    await settle(page);
    await expect(form).toHaveScreenshot('deposit-form.png');
  });
});
