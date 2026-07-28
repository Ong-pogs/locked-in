import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

// ── DepositV2 dependency mocks ──────────────────────────────────────────────
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('courseId=blockchain-wallets'),
}));

const solanaWallets = [{ address: 'C5D95rPis3kw4Vpig3A3fUFryA1FNzSLRbAQG7uLKkkB' }];
vi.mock('@privy-io/react-auth/solana', () => ({
  useWallets: () => ({ wallets: solanaWallets }),
  useSignTransaction: () => ({ signTransaction: vi.fn() }),
}));

const OWNER = 'C5D95rPis3kw4Vpig3A3fUFryA1FNzSLRbAQG7uLKkkB';
const courseState = {
  courses: [{ id: 'blockchain-wallets', title: 'Blockchain & Wallets' }],
  activateCourse: vi.fn(),
};
const userState = { walletAddress: OWNER, setOnboardingPhase: vi.fn() };
vi.mock('@/stores', () => ({
  useCourseStore: Object.assign((sel: (s: typeof courseState) => unknown) => sel(courseState), {
    getState: () => courseState,
  }),
  useUserStore: Object.assign((sel: (s: typeof userState) => unknown) => sel(userState), {
    getState: () => userState,
  }),
}));

const getBalance = vi.fn();
vi.mock('@/services/solana/connection', () => ({
  connection: { getBalance: (...a: unknown[]) => getBalance(...a) },
  CLUSTER: 'mainnet-beta',
  RPC_ENDPOINT: 'http://mock',
}));

const readWalletUsdcUi = vi.fn();
vi.mock('@/services/solana/vaultV2', () => ({
  readWalletUsdcUi: (...a: unknown[]) => readWalletUsdcUi(...a),
  readVaultV2Config: vi.fn().mockResolvedValue({ currentTvlUi: '10' }),
  deriveLockPda: vi.fn(),
}));

vi.mock('@/services/api/locks/locksApi', () => ({
  getLockEligibility: vi.fn().mockResolvedValue({ eligible: true }),
}));
vi.mock('@/services/api/httpClient', () => ({
  fetchWithAuth: (fn: (token: string) => Promise<unknown>) => fn('test-token'),
  httpRequest: vi.fn(),
}));
vi.mock('@/services/api', () => ({
  fetchWithAuth: (fn: (token: string) => Promise<unknown>) => fn('test-token'),
}));

const requestGasStipend = vi.fn();
vi.mock('@/services/onramp/gasStipend', () => ({
  requestGasStipend: (...a: unknown[]) => requestGasStipend(...a),
}));

const addFunds = vi.fn();
vi.mock('@/services/onramp/useAddFunds', () => ({
  useAddFunds: () => ({ addFunds, pending: false, error: null, clearError: vi.fn() }),
}));

vi.mock('@/services/enroll/pendingEnroll', () => ({
  clearPendingEnroll: vi.fn(),
  enrollLockWithRetry: vi.fn(),
  writePendingEnroll: vi.fn(),
}));

import { DepositV2 } from '@/app/onboarding/deposit/DepositV2';
import { FUNDING_BREADCRUMB_KEY, writeFundingBreadcrumb } from '@/services/onramp/fundingBreadcrumb';

const ENOUGH_SOL = 0.01 * 1_000_000_000;

describe('DepositV2 — funding wiring', () => {
  beforeEach(() => {
    getBalance.mockReset();
    readWalletUsdcUi.mockReset();
    requestGasStipend.mockReset();
    addFunds.mockReset();
    localStorage.clear();
  });

  it('auto-requests the gas stipend on an empty wallet and unlocks the form when dripped', async () => {
    // First gate read: 0 lamports → insufficient. After the drip: enough.
    getBalance.mockResolvedValueOnce(0).mockResolvedValue(ENOUGH_SOL);
    readWalletUsdcUi.mockResolvedValue('0');
    requestGasStipend.mockResolvedValue({ status: 'dripped' });

    render(<DepositV2 />);

    await waitFor(() => expect(requestGasStipend).toHaveBeenCalledTimes(1));
    expect(requestGasStipend).toHaveBeenCalledWith('test-token');
    // dripped → gate re-read → form appears
    await waitFor(() => expect(screen.getByTestId('v2-deposit-form')).toBeTruthy());
  });

  it('leaves the SOL gate standing on cap_reached and never re-requests', async () => {
    getBalance.mockResolvedValue(0);
    readWalletUsdcUi.mockResolvedValue('0');
    requestGasStipend.mockResolvedValue({ status: 'cap_reached' });

    render(<DepositV2 />);

    await waitFor(() => expect(requestGasStipend).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('v2-sol-gate-blocked')).toBeTruthy());
    expect(screen.queryByTestId('v2-deposit-form')).toBeNull();
  });

  it('add-funds covered path clears the breadcrumb; settling path shows the notice', async () => {
    getBalance.mockResolvedValue(ENOUGH_SOL);
    // Mount read: $0. Post-modal read: covered ($25 for the default preset).
    readWalletUsdcUi.mockResolvedValueOnce('0').mockResolvedValueOnce('25');
    addFunds.mockResolvedValue(true);
    writeFundingBreadcrumb({ address: OWNER, amountUsdc: 27 });

    render(<DepositV2 />);
    await waitFor(() => expect(screen.getByTestId('v2-deposit-form')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('v2-add-funds')).toBeTruthy());

    // Breadcrumb fresh → first tap is the confirm gate, second tap buys.
    fireEvent.click(screen.getByTestId('v2-add-funds'));
    expect(addFunds).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByTestId('v2-add-funds'));
    });
    await waitFor(() =>
      expect(addFunds).toHaveBeenCalledWith({
        deficitUsdc: 25,
        ownerAddress: OWNER,
        wallets: solanaWallets,
      }),
    );
    // Covered → breadcrumb cleared, no settling notice.
    await waitFor(() => expect(localStorage.getItem(FUNDING_BREADCRUMB_KEY)).toBeNull());
    expect(screen.queryByTestId('v2-funding-notice')).toBeNull();
  });

  it('shows the settling notice + check-again when funds have not landed yet', async () => {
    getBalance.mockResolvedValue(ENOUGH_SOL);
    // Mount: $0. Post-modal: improved but short. Check-again: covered.
    readWalletUsdcUi
      .mockResolvedValueOnce('0')
      .mockResolvedValueOnce('5')
      .mockResolvedValueOnce('25');
    addFunds.mockResolvedValue(true);

    render(<DepositV2 />);
    await waitFor(() => expect(screen.getByTestId('v2-add-funds')).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByTestId('v2-add-funds'));
    });
    await waitFor(() => expect(screen.getByTestId('v2-funding-notice')).toBeTruthy());

    // Manual re-check picks up the settled balance; CTA + notice disappear
    // (balance now covers the amount).
    await act(async () => {
      fireEvent.click(screen.getByTestId('v2-funding-check-again'));
    });
    await waitFor(() => expect(screen.queryByTestId('v2-add-funds')).toBeNull());
  });
});
