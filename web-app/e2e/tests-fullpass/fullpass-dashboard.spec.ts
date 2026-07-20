import { test, expect, type FpClaimReceiptSeed } from '../fixtures/fullpass.fixture';
import { COURSE_A, COURSE_B } from '../fixtures/fullpass-mocks';
import { FIXED_EPOCH } from '../fixtures/v2-mocks';

// Dashboard positions tabs (Active / Claimed): a settled course (done +
// CLOSED/NONE) moves under Claimed as a ClosedPositionCard with the claim
// receipt read from sessionStorage; live/errored positions can never hide
// there. Includes the position-fetch failure + Retry path and both designed
// empty states.

const DAY_MS = 24 * 3600 * 1000;

// What the claim page would have persisted earlier this session.
const RECEIPT_B: FpClaimReceiptSeed = {
  signature: 'E2E_SEEDED_SIG_claim_2222222222222222222222222222222222',
  principalUi: '12',
  receivedUi: '12.8412',
  bps: 10_000,
  lapseCount: 0,
  claimedAt: new Date(FIXED_EPOCH.getTime() - DAY_MS).toISOString(), // Jul 14 (UTC-pinned)
};

test.describe('happy: active position on Active tab, claimed course on Claimed tab', () => {
  test.use({ scenario: 'mixed', claimReceipts: { [COURSE_B.id]: RECEIPT_B } });

  test('tabs split live vs settled; Claimed shows the receipt and its practice CTA navigates', async ({
    fpPage: page,
  }) => {
    await page.goto('/dashboard');

    // Active tab is selected by default and counts ONLY the live position
    // (the settled course leaves as soon as its CLOSED position lands).
    const activeTab = page.getByTestId('v2-positions-tab-active');
    const claimedTab = page.getByTestId('v2-positions-tab-claimed');
    await expect(activeTab).toBeVisible({ timeout: 20_000 });
    await expect(activeTab).toHaveAttribute('aria-selected', 'true');
    await expect(activeTab).toContainText('Active · 1');
    await expect(claimedTab).toContainText('Claimed · 1');

    // Active tab: exactly the live course-A card with its position value.
    const card = page.getByTestId('v2-position-card');
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute('data-course-id', COURSE_A.id);
    await expect(page.getByTestId('v2-position-value')).toContainText('$50.3841');
    await expect(page.getByTestId('v2-closed-card')).toHaveCount(0);

    // Claimed tab: the settled course-B card with chip + sessionStorage receipt.
    await claimedTab.click();
    await expect(claimedTab).toHaveAttribute('aria-selected', 'true');
    const closed = page.getByTestId('v2-closed-card');
    await expect(closed).toBeVisible();
    await expect(closed).toHaveAttribute('data-course-id', COURSE_B.id);
    await expect(page.getByTestId('v2-claimed-chip')).toContainText('Claimed');
    await expect(closed).toContainText('Paid out $12.8412 to your wallet · Jul 14');
    await expect(closed).toContainText(`tx: ${RECEIPT_B.signature}`);
    // No live-position furniture on a settled card.
    await expect(page.getByTestId('v2-position-card')).toHaveCount(0);

    // The practice affordance the course keeps forever.
    await page.getByTestId('v2-closed-practice-cta').click();
    await page.waitForURL('**/practice', { timeout: 20_000 });
    await expect(page.locator('h1')).toHaveText('Practice Hall', { timeout: 20_000 });
  });
});

test.describe('sad: position fetch failure — Couldn’t load position + working Retry', () => {
  test.use({ scenario: 'learning', positionMode: 'fail' });

  test('500s surface the retry affordance; retry after the backend heals renders the value', async ({
    fpPage: page,
    fpApi,
  }) => {
    await page.goto('/dashboard');

    // Every position poll 500s → the card offers Retry instead of wedging
    // on "Loading position…".
    const value = page.getByTestId('v2-position-value');
    await expect(value).toContainText(/Couldn.t load position/, { timeout: 20_000 });
    const retry = page.getByTestId('v2-position-retry');
    await expect(retry).toBeVisible();

    // Boot fires TWO position polls (dashboard mount + the AppShell
    // enrollments restore re-triggering the effect). Both must have failed
    // before the backend heals, or a late boot poll could repair the card on
    // its own mid-click and detach the Retry button.
    await expect
      .poll(() => fpApi.positionRequests(COURSE_A.id), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(2);

    // Backend heals; the card's Retry re-polls in place (no reload).
    fpApi.setPositionMode('ok');
    await retry.click();
    await expect(value).toContainText('$50.3841');
    await expect(page.getByTestId('v2-position-retry')).toHaveCount(0);
  });
});

test.describe('sad: only-claimed user — Active tab shows the empty note with Browse CTA', () => {
  test.use({ scenario: 'onlyClaimed' });

  test('everything settled leaves Active empty; Browse courses navigates', async ({
    fpPage: page,
  }) => {
    await page.goto('/dashboard');

    // The single course settles into Claimed, so Active shows the designed
    // empty card (never a blank section).
    const empty = page.getByTestId('v2-positions-tab-empty');
    await expect(empty).toBeVisible({ timeout: 20_000 });
    await expect(empty).toContainText('No active positions');
    await expect(page.getByTestId('v2-positions-tab-claimed')).toContainText('Claimed · 1');
    await expect(page.getByTestId('v2-position-card')).toHaveCount(0);

    await empty.getByRole('button', { name: 'Browse courses' }).click();
    await page.waitForURL('**/courses', { timeout: 20_000 });
  });
});

test.describe('sad: fresh user — Claimed tab shows the empty note without a CTA', () => {
  test.use({ scenario: 'learning' });

  test('nothing claimed yet renders the note; no Browse CTA on the Claimed tab', async ({
    fpPage: page,
  }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('v2-position-card')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('v2-positions-tab-claimed').click();
    const empty = page.getByTestId('v2-positions-tab-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('Nothing claimed yet');
    // The Browse CTA belongs to the Active tab's empty state only.
    await expect(empty.getByRole('button')).toHaveCount(0);
    await expect(page.getByTestId('v2-closed-card')).toHaveCount(0);
  });
});
