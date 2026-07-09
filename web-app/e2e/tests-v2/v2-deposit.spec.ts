import { test, expect } from '../fixtures/v2.fixture';
import { COURSE_ID } from '../fixtures/v2-mocks';

// v2 deposit: $10–50 bounds, NO duration picker anywhere in the DOM, capacity
// meter present, stubbed submit reaches the village redirect.

test.describe('v2 deposit', () => {
  test.use({ scenario: 'active' });

  test('renders the v2 form with capacity meter and NO duration picker', async ({ v2Page: page }) => {
    await page.goto(`/onboarding/deposit?courseId=${COURSE_ID}`);
    await expect(page.getByTestId('v2-deposit-form')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('v2-capacity-meter')).toBeVisible();
    await expect(page.getByTestId('v2-capacity-meter')).toContainText('$1,000');
    // Duration must be ABSENT (v2 locks release on completion, not a timer).
    await expect(page.getByText(/duration/i)).toHaveCount(0);
    await expect(page.getByText(/\b(14|30|45|60|90|180|365)\s*days?\b/i)).toHaveCount(0);
  });

  test('rejects below-minimum and above-maximum amounts', async ({ v2Page: page }) => {
    await page.goto(`/onboarding/deposit?courseId=${COURSE_ID}`);
    const amount = page.getByTestId('v2-deposit-amount');
    await expect(amount).toBeVisible({ timeout: 20_000 });

    await amount.fill('5');
    await expect(page.getByTestId('v2-deposit-error')).toContainText('Minimum is $10');
    await expect(page.getByTestId('v2-deposit-submit')).toBeDisabled();

    await amount.fill('75');
    await expect(page.getByTestId('v2-deposit-error')).toContainText('Maximum is $50');
    await expect(page.getByTestId('v2-deposit-submit')).toBeDisabled();

    await amount.fill('25');
    await expect(page.getByTestId('v2-deposit-error')).toHaveCount(0);
    await expect(page.getByTestId('v2-deposit-submit')).toBeEnabled();
  });

  test('stubbed submit lands in the village (post-lock home)', async ({ v2Page: page }) => {
    await page.goto(`/onboarding/deposit?courseId=${COURSE_ID}`);
    await expect(page.getByTestId('v2-deposit-amount')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('v2-deposit-amount').fill('25');
    await page.getByTestId('v2-deposit-submit').click();
    await page.waitForURL('**/village', { timeout: 15_000 });
  });
});
