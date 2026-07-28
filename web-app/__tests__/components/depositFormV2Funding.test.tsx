import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/services/api', () => ({ fetchWithAuth: vi.fn() }));
vi.mock('@/services/api/httpClient', () => ({ httpRequest: vi.fn() }));

import { DepositFormV2 } from '@/components/v2/DepositFormV2';
import { writeFundingBreadcrumb } from '@/services/onramp/fundingBreadcrumb';

function renderForm(overrides: Partial<Parameters<typeof DepositFormV2>[0]> = {}) {
  return render(
    <DepositFormV2
      courseTitle="Blockchain & Wallets"
      currentTvlUi={10}
      walletBalanceUi="0"
      phase="idle"
      statusMessage={null}
      onSubmit={vi.fn()}
      {...overrides}
    />,
  );
}

describe('DepositFormV2 — Add funds', () => {
  beforeEach(() => localStorage.clear());

  it('renders the CTA with the deficit when balance is short (default $25 preset)', () => {
    const onAddFunds = vi.fn();
    renderForm({ onAddFunds });
    const btn = screen.getByTestId('v2-add-funds');
    expect(btn.textContent).toContain('$25');
    fireEvent.click(btn);
    expect(onAddFunds).toHaveBeenCalledWith(25);
  });

  it('computes a partial deficit from a nonzero balance', () => {
    const onAddFunds = vi.fn();
    renderForm({ onAddFunds, walletBalanceUi: '15' });
    fireEvent.click(screen.getByTestId('v2-add-funds'));
    expect(onAddFunds).toHaveBeenCalledWith(10);
  });

  it('hides the CTA when the balance is unknown (null)', () => {
    renderForm({ onAddFunds: vi.fn(), walletBalanceUi: null });
    expect(screen.queryByTestId('v2-add-funds')).toBeNull();
  });

  it('hides the CTA when the wallet already covers the amount', () => {
    renderForm({ onAddFunds: vi.fn(), walletBalanceUi: '30' });
    expect(screen.queryByTestId('v2-add-funds')).toBeNull();
  });

  it('hides the CTA without an onAddFunds handler', () => {
    renderForm();
    expect(screen.queryByTestId('v2-add-funds')).toBeNull();
  });

  it('disables the CTA while funding is pending', () => {
    renderForm({ onAddFunds: vi.fn(), fundingPending: true });
    expect((screen.getByTestId('v2-add-funds') as HTMLButtonElement).disabled).toBe(true);
  });

  it('replaces the CTA with capacity copy when the beta cap cannot fit the lock', () => {
    renderForm({ onAddFunds: vi.fn(), currentTvlUi: 980 });
    expect(screen.queryByTestId('v2-add-funds')).toBeNull();
    expect(screen.getByTestId('v2-capacity-blocked')).toBeTruthy();
  });

  it('gates a re-buy behind an explicit confirm while a breadcrumb is fresh', () => {
    writeFundingBreadcrumb({ address: 'Abc', amountUsdc: 27 });
    const onAddFunds = vi.fn();
    renderForm({ onAddFunds });
    const btn = screen.getByTestId('v2-add-funds');
    fireEvent.click(btn);
    expect(onAddFunds).not.toHaveBeenCalled();
    expect(screen.getByTestId('v2-funding-confirm')).toBeTruthy();
    fireEvent.click(btn); // "Buy anyway"
    expect(onAddFunds).toHaveBeenCalledWith(25);
  });

  it('renders the funding notice', () => {
    renderForm({ onAddFunds: vi.fn(), fundingNotice: 'Funds can take a few minutes to arrive.' });
    expect(screen.getByTestId('v2-funding-notice').textContent).toContain('few minutes');
  });
});
