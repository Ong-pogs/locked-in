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
    // Footer disconnect (sign-out affordance shipped with the v2 dashboard).
    await expect(page.getByTestId('v2-disconnect')).toBeVisible();
  });

  // Carried-over sections (XP hero, journey stats, activity heatmap).
  test('renders the XP hero, journey stats, and activity heatmap', async ({ v2Page: page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('v2-xp-hero')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('v2-xp-bar')).toBeVisible();
    await expect(page.getByTestId('v2-journey')).toBeVisible();
    await expect(page.getByTestId('v2-journey')).toContainText('Lessons Completed');
    // Calendar-year heatmap (year selector + stats line replaced the old
    // "Past Year of Activity" rolling view).
    await expect(page.getByTestId('v2-heatmap')).toBeVisible();
    await expect(page.getByTestId('v2-heatmap')).toContainText('Activity');
    await expect(page.getByTestId('v2-heatmap')).toContainText('active days');
    await expect(
      page.getByTestId('v2-heatmap').getByRole('button', { name: '2026', exact: true }),
    ).toBeVisible();
  });

  // Prod smoke found the page 11px wider than a 390px viewport: the pixel-font
  // title and the APY chip in the header row both refused to shrink. The
  // heatmap is legitimately wider than the screen but must stay inside its own
  // scroller — so assert on the DOCUMENT, which catches either regression.
  test('page never scrolls horizontally', async ({ v2Page: page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('v2-dashboard')).toBeVisible({ timeout: 20_000 });
    const { scrollW, clientW } = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    expect(scrollW, `document overflows viewport by ${scrollW - clientW}px`).toBeLessThanOrEqual(
      clientW + 1,
    );
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
  // Positions-tabs successor behavior: a completed course with a CLOSED lock
  // is SETTLED — it leaves the Active tab entirely and renders as a closed
  // card under Claimed. CLAIM must not exist on either tab.
  test('completed course with CLOSED lock settles into the Claimed tab, never CLAIM', async ({ v2Page: page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('v2-positions-tab-claimed')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('v2-claim-cta')).toHaveCount(0);
    await page.getByTestId('v2-positions-tab-claimed').click();
    await expect(page.getByTestId('v2-closed-card')).toBeVisible();
    await expect(page.getByTestId('v2-claimed-chip')).toBeVisible();
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
