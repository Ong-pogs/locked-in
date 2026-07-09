import { test as base } from '@playwright/test';
import { test, expect } from '../fixtures/v2.fixture';
import { COURSE_ID, FIXED_EPOCH, SCENARIOS, voucherResponse } from '../fixtures/v2-mocks';

// CLAIM flow: review breakdown -> stubbed sign -> success record. The tx stub
// (localhost-gated) lets the REAL success screen render without Privy.

test.describe('claim — review (clean, bps 10000)', () => {
  test.use({ scenario: 'claimable' });
  test('shows principal, split percentages, absolute expiry date', async ({ v2Page: page }) => {
    await page.goto(`/claim/${COURSE_ID}`);
    const review = page.getByTestId('v2-claim-review');
    await expect(review).toBeVisible({ timeout: 20_000 });

    await expect(review).toContainText('$50'); // principal from store
    await expect(review).toContainText('100%'); // yield kept
    await expect(review).toContainText('0%'); // to pot
    await expect(review).toContainText('Voucher valid until Jul 17, 2026'); // absolute, never relative
    await expect(page.getByTestId('v2-penalty-banner')).toHaveCount(0);
  });

  test('claim click drives the stub to the real success screen with breakdown', async ({ v2Page: page }) => {
    await page.goto(`/claim/${COURSE_ID}`);
    await expect(page.getByTestId('v2-claim-review')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('v2-claim-submit').click();

    const success = page.getByTestId('v2-claim-success');
    await expect(success).toBeVisible({ timeout: 15_000 });
    const breakdown = page.getByTestId('v2-claim-breakdown');
    await expect(breakdown).toContainText('$50'); // principal
    await expect(breakdown).toContainText('100%'); // kept
    await expect(breakdown).toContainText('$51.213'); // exact ATA delta from stub
    await expect(success).toContainText('E2E_STUB_SIG_claim'); // tx signature shown
  });

  test('success survives reload via sessionStorage (review unreachable after claim)', async ({ v2Page: page }) => {
    await page.goto(`/claim/${COURSE_ID}`);
    await expect(page.getByTestId('v2-claim-review')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('v2-claim-submit').click();
    await expect(page.getByTestId('v2-claim-success')).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(page.getByTestId('v2-claim-success')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('v2-claim-review')).toHaveCount(0);
  });
});

test.describe('claim — penalty variant (bps 5000)', () => {
  test.use({ scenario: 'lapsedOne' });
  test('review shows 50/50 split + penalty banner', async ({ v2Page: page }) => {
    await page.goto(`/claim/${COURSE_ID}`);
    const review = page.getByTestId('v2-claim-review');
    await expect(review).toBeVisible({ timeout: 20_000 });
    await expect(review).toContainText('50%');
    await expect(page.getByTestId('v2-penalty-banner')).toBeVisible();
    await expect(page.getByTestId('v2-penalty-banner')).toContainText('50% of yield forfeits');
  });
});

test.describe('claim — no voucher (course incomplete)', () => {
  test.use({ scenario: 'active', voucherStatus: 403 });
  test('renders the themed no-voucher terminal state', async ({ v2Page: page }) => {
    await page.goto(`/claim/${COURSE_ID}`);
    await expect(page.getByTestId('v2-claim-no-voucher')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('v2-claim-no-voucher')).toContainText('Finish the course first');
    await expect(page.getByTestId('v2-claim-submit')).toHaveCount(0);
  });
});

// Edge auth guard: a cookie-less deep link must 307 to /village at the proxy.
// Plain @playwright/test — deliberately NO fixture cookies.
base('claim deep link without auth cookies redirects to /village', async ({ page }) => {
  await page.goto(`/claim/${COURSE_ID}`);
  await page.waitForURL('**/village', { timeout: 20_000 });
});

// Voucher shape sanity: the mock the suite runs on matches the real backend
// response contract (fields the page consumes).
base('voucher mock carries the contract fields', async () => {
  const v = voucherResponse(SCENARIOS.claimable);
  for (const k of ['lock', 'authorityPubkey', 'bps', 'expiry', 'message', 'signature', 'lapseCount']) {
    if (!(k in v)) throw new Error(`voucher mock missing ${k}`);
  }
  if (v.expiry * 1000 <= FIXED_EPOCH.getTime()) throw new Error('voucher mock expiry must be future');
});
