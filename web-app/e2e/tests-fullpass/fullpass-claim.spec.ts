import { test, expect } from '../fixtures/fullpass.fixture';
import { COURSE_A } from '../fixtures/fullpass-mocks';

// CLAIM: review breakdown → stubbed sign (window.__lockedInTxStub) → success
// record → the settled course lands under the dashboard's Claimed tab with
// the receipt the claim page just persisted. Plus the two voucher sad paths:
// 403 (course incomplete) and an expired voucher.

test.describe('happy: claim via the tx stub, then the Claimed tab shows the receipt', () => {
  test.use({ scenario: 'claimable' });

  test('review → claim → success breakdown → dashboard Claimed tab', async ({
    fpPage: page,
    fpApi,
  }) => {
    await page.goto(`/claim/${COURSE_A.id}`);

    // Review: principal, clean 100/0 split, absolute voucher expiry.
    const review = page.getByTestId('v2-claim-review');
    await expect(review).toBeVisible({ timeout: 20_000 });
    await expect(review).toContainText('$50'); // server-truth principal
    await expect(review).toContainText('100%'); // yield kept (no lapses)
    await expect(review).toContainText('Voucher valid until Jul 17, 2026');

    // Claim — the stub signs; the REAL success screen renders.
    await page.getByTestId('v2-claim-submit').click();
    const success = page.getByTestId('v2-claim-success');
    await expect(success).toBeVisible({ timeout: 15_000 });
    const breakdown = page.getByTestId('v2-claim-breakdown');
    await expect(breakdown).toContainText('$50'); // principal returned
    await expect(breakdown).toContainText('$51.213'); // exact ATA delta from the stub
    await expect(success).toContainText('E2E_STUB_SIG_claim'); // tx signature shown

    // The close settles server-side; back on the dashboard the course now
    // lives under Claimed with the receipt the claim page just persisted.
    fpApi.setPositionStatus(COURSE_A.id, 'CLOSED');
    await page.getByRole('button', { name: 'Back to dashboard' }).click();
    await expect(page.getByTestId('v2-dashboard')).toBeVisible({ timeout: 20_000 });

    const claimedTab = page.getByTestId('v2-positions-tab-claimed');
    await expect(claimedTab).toContainText('Claimed · 1');
    await claimedTab.click();
    const closed = page.getByTestId('v2-closed-card');
    await expect(closed).toBeVisible();
    await expect(closed).toHaveAttribute('data-course-id', COURSE_A.id);
    await expect(page.getByTestId('v2-claimed-chip')).toBeVisible();
    await expect(closed).toContainText('Paid out $51.2130 to your wallet');
    await expect(closed).toContainText('E2E_STUB_SIG_claim');
  });
});

test.describe('sad: voucher 403 — course not complete', () => {
  test.use({ scenario: 'learning', voucherMode: 403 });

  test('deep-linking the claim before finishing renders the themed no-voucher terminal state', async ({
    fpPage: page,
  }) => {
    await page.goto(`/claim/${COURSE_A.id}`);
    const noVoucher = page.getByTestId('v2-claim-no-voucher');
    await expect(noVoucher).toBeVisible({ timeout: 20_000 });
    await expect(noVoucher).toContainText('Finish the course first');
    // No way to submit a claim from here.
    await expect(page.getByTestId('v2-claim-submit')).toHaveCount(0);
    await expect(noVoucher.getByRole('button', { name: 'Back to dashboard' })).toBeVisible();
  });
});

test.describe('sad: voucher expired — terminal expired screen', () => {
  test.use({ scenario: 'claimable', voucherMode: 'expired' });

  test('an expired voucher renders the expired screen instead of the review', async ({
    fpPage: page,
  }) => {
    await page.goto(`/claim/${COURSE_A.id}`);
    await expect(page.getByText('Voucher expired')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/a fresh voucher will be issued/)).toBeVisible();
    // Neither the review nor the submit is reachable.
    await expect(page.getByTestId('v2-claim-review')).toHaveCount(0);
    await expect(page.getByTestId('v2-claim-submit')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Back to dashboard' })).toBeVisible();
  });
});
