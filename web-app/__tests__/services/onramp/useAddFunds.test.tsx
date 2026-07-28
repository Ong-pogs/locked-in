import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const fundWallet = vi.fn();
vi.mock('@privy-io/react-auth/solana', () => ({
  useFundWallet: () => ({ fundWallet }),
}));
vi.mock('@/services/solana/connection', () => ({
  CLUSTER: 'mainnet-beta',
  RPC_ENDPOINT: 'http://mock',
}));

import { useAddFunds } from '@/services/onramp/useAddFunds';
import {
  readFundingBreadcrumb,
  FUNDING_BREADCRUMB_KEY,
} from '@/services/onramp/fundingBreadcrumb';
import { missingSignerMessage } from '@/services/solana/pickSignerWallet';

const OWNER = 'C5D95rPis3kw4Vpig3A3fUFryA1FNzSLRbAQG7uLKkkB';
const WALLETS = [{ address: 'SomeOtherWallet1111111111111111111111111111' }, { address: OWNER }];

describe('useAddFunds', () => {
  beforeEach(() => {
    fundWallet.mockReset();
    localStorage.clear();
  });

  it('funds the owner wallet with a buffered string amount on mainnet USDC', async () => {
    fundWallet.mockResolvedValue(undefined);
    const { result } = renderHook(() => useAddFunds());
    let ran = false;
    await act(async () => {
      ran = await result.current.addFunds({ deficitUsdc: 10, ownerAddress: OWNER, wallets: WALLETS });
    });
    expect(ran).toBe(true);
    expect(fundWallet).toHaveBeenCalledWith({
      address: OWNER,
      options: { asset: 'USDC', chain: 'solana:mainnet', amount: '12' },
    });
  });

  it('refuses when the owner wallet is not connected — fundWallet never called', async () => {
    const { result } = renderHook(() => useAddFunds());
    let ran = true;
    await act(async () => {
      ran = await result.current.addFunds({
        deficitUsdc: 10,
        ownerAddress: OWNER,
        wallets: [{ address: 'SomeOtherWallet1111111111111111111111111111' }],
      });
    });
    expect(ran).toBe(false);
    expect(fundWallet).not.toHaveBeenCalled();
    expect(result.current.error).toBe(missingSignerMessage(OWNER));
    expect(localStorage.getItem(FUNDING_BREADCRUMB_KEY)).toBeNull();
  });

  it('writes the breadcrumb before the modal resolves', async () => {
    let breadcrumbAtCall: string | null = 'unset';
    fundWallet.mockImplementation(async () => {
      breadcrumbAtCall = localStorage.getItem(FUNDING_BREADCRUMB_KEY);
    });
    const { result } = renderHook(() => useAddFunds());
    await act(async () => {
      await result.current.addFunds({ deficitUsdc: 10, ownerAddress: OWNER, wallets: WALLETS });
    });
    expect(breadcrumbAtCall).not.toBeNull();
    expect(readFundingBreadcrumb()).toMatchObject({ address: OWNER, amountUsdc: 12 });
  });

  it('maps a pre-modal rejection to neutral copy and returns false', async () => {
    fundWallet.mockRejectedValue(new Error('plugin exploded'));
    const { result } = renderHook(() => useAddFunds());
    let ran = true;
    await act(async () => {
      ran = await result.current.addFunds({ deficitUsdc: 10, ownerAddress: OWNER, wallets: WALLETS });
    });
    expect(ran).toBe(false);
    expect(result.current.error).toBe("Couldn't open funding — try again.");
    expect(result.current.pending).toBe(false);
  });

  it('pending is true while the modal is open, false after', async () => {
    let release: () => void = () => {};
    fundWallet.mockImplementation(() => new Promise<void>((r) => { release = r; }));
    const { result } = renderHook(() => useAddFunds());
    let call: Promise<boolean> | null = null;
    act(() => {
      call = result.current.addFunds({ deficitUsdc: 10, ownerAddress: OWNER, wallets: WALLETS });
    });
    expect(result.current.pending).toBe(true);
    await act(async () => {
      release();
      await call;
    });
    expect(result.current.pending).toBe(false);
  });
});
