import { test, expect } from '../fixtures/v2.fixture';

// v2 dashboard state matrix. Every data-bearing spec-§5 element gets a
// functional assertion; determinism rules: no waitForTimeout, no
// "dashboard OR redirect" hedging — the card MUST render.

test.describe('v2 dashboard — gate sanity', () => {
  test('renders the v2 dashboard (world switch on)', async ({ v2Page: page }) => {
    await page.goto('/dashboard');
    await expect(
      page.getByTestId('v2-dashboard'),
      'v2-dashboard testid missing — dev server lacks NEXT_PUBLIC_VAULT_V2_PROGRAM_ID (use the v2 config webServer)',
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('h1')).toHaveText('Dashboard');
  });

  // Carried-over sections (XP hero, journey stats, activity heatmap).
  test('renders the XP hero, journey stats, and activity heatmap', async ({ v2Page: page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('v2-xp-hero')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('v2-xp-bar')).toBeVisible();
    await expect(page.getByTestId('v2-journey')).toBeVisible();
    await expect(page.getByTestId('v2-journey')).toContainText('Lessons Completed');
    await expect(page.getByTestId('v2-heatmap')).toBeVisible();
    await expect(page.getByTestId('v2-heatmap')).toContainText('Past Year of Activity');
  });
});

test.describe('v2 dashboard — active (blazing)', () => {
  test.use({ scenario: 'active' });
  test('card shows position value, blazing flame, full shields, streak, progress', async ({ v2Page: page }) => {
    await page.goto('/dashboard');
    const card = page.getByTestId('v2-position-card');
    await expect(card).toBeVisible({ timeout: 20_000 });

    await expect(page.getByTestId('v2-position-value')).toContainText('$50.3841');
    await expect(page.getByTestId('v2-flame-gauge')).toHaveAttribute('data-state', 'blazing');
    await expect(page.getByTestId('v2-shield-pips')).toHaveAttribute('data-shields', '3');
    await expect(page.getByTestId('v2-streak')).toContainText('5-day streak');
    await expect(card).toContainText('1/3');
    await expect(page.getByTestId('v2-next-lesson-cta')).toContainText('Accounts');
    // No penalty, no claim, no practice.
    await expect(page.getByTestId('v2-penalty-banner')).toHaveCount(0);
    await expect(page.getByTestId('v2-claim-cta')).toHaveCount(0);
    await expect(page.getByTestId('v2-practice-badge')).toHaveCount(0);
  });
});

test.describe('v2 dashboard — at risk (flickering + countdown)', () => {
  test.use({ scenario: 'atRisk' });
  test('flickering flame, burned shield pip, countdown to UTC midnight', async ({ v2Page: page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('v2-flame-gauge')).toHaveAttribute('data-state', 'flickering', { timeout: 20_000 });
    await expect(page.getByTestId('v2-shield-pips')).toHaveAttribute('data-shields', '2');
    // dayEndsAtUtc is FIXED_EPOCH + 12h and the clock is frozen at FIXED_EPOCH.
    await expect(page.getByTestId('v2-day-countdown')).toContainText('12h');
  });
});

test.describe('v2 dashboard — first lapse (dark, −50%)', () => {
  test.use({ scenario: 'lapsedOne' });
  test('dark flame + 50% penalty banner', async ({ v2Page: page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('v2-flame-gauge')).toHaveAttribute('data-state', 'dark', { timeout: 20_000 });
    const banner = page.getByTestId('v2-penalty-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('50% of yield forfeits');
    await expect(page.getByTestId('v2-shield-pips')).toHaveAttribute('data-shields', '0');
  });
});

test.describe('v2 dashboard — second lapse (extinguished, −100%)', () => {
  test.use({ scenario: 'lapsedTwo' });
  test('extinguished flame + 100% penalty banner', async ({ v2Page: page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('v2-flame-gauge')).toHaveAttribute('data-state', 'extinguished', { timeout: 20_000 });
    await expect(page.getByTestId('v2-penalty-banner')).toContainText('100% of yield forfeits');
  });
});

test.describe('v2 dashboard — claimable', () => {
  test.use({ scenario: 'claimable' });
  test('CLAIM armed when voucherAvailable && position ACTIVE', async ({ v2Page: page }) => {
    await page.goto('/dashboard');
    const claim = page.getByTestId('v2-claim-cta');
    await expect(claim).toBeVisible({ timeout: 20_000 });
    await expect(claim).toContainText(/claim/i);
    await expect(page.getByTestId('v2-next-lesson-cta')).toHaveCount(0); // course done
  });
});

test.describe('v2 dashboard — practice mode', () => {
  test.use({ scenario: 'practice' });
  test('completed course with CLOSED lock shows practice badge, never CLAIM', async ({ v2Page: page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('v2-practice-badge')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('v2-claim-cta')).toHaveCount(0);
  });
});

test.describe('v2 dashboard — null live value', () => {
  test.use({ scenario: 'nullValue' });
  test('falls back to principal when the exchange rate is unreadable', async ({ v2Page: page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('v2-position-value')).toContainText('$50', { timeout: 20_000 });
  });
});
