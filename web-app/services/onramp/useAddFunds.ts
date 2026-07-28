'use client';

// The only file that knows Privy funding exists. Wraps useFundWallet with the
// three guards the money path needs:
//   - signer validation: fund ONLY the wallet that will sign the deposit
//     (pickSignerWallet — funding wallets[0] recreates the 4100 claim-mismatch
//     bug class one step earlier, with fiat);
//   - breadcrumb BEFORE the modal: iOS-PWA death during the provider/3DS leg
//     erases React state, and a re-buy without the record double-charges;
//   - watchdog: the same PWA lifecycle can eat the modal-exit event, leaving
//     `pending` stuck true — revive the button on refocus after a grace
//     period instead of demanding a full reload.
//
// Solana fundWallet returns Promise<void> — there is NO result/status object
// (that's the EVM hook). Outcomes are decided by re-reading the wallet
// balance after exit; callers own that flow.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFundWallet } from '@privy-io/react-auth/solana';
import { CLUSTER } from '@/services/solana/connection';
import { pickSignerWallet, missingSignerMessage } from '@/services/solana/pickSignerWallet';
import { computeOnrampAmount } from './computeOnrampAmount';
import { writeFundingBreadcrumb } from './fundingBreadcrumb';

const FUNDING_CHAIN = (
  CLUSTER === 'mainnet-beta' ? 'solana:mainnet' : `solana:${CLUSTER}`
) as 'solana:mainnet' | 'solana:devnet' | 'solana:testnet';

const WATCHDOG_GRACE_MS = 60_000;

export interface AddFundsArgs {
  deficitUsdc: number;
  ownerAddress: string;
  wallets: readonly { address: string }[];
}

export function useAddFunds() {
  const { fundWallet } = useFundWallet();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!pending) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const openedAt = openedAtRef.current;
      if (openedAt != null && Date.now() - openedAt > WATCHDOG_GRACE_MS) setPending(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [pending]);

  /** Returns true when the funding modal ran (caller should re-read the
   *  balance), false when refused or failed before the modal opened. */
  const addFunds = useCallback(
    async ({ deficitUsdc, ownerAddress, wallets }: AddFundsArgs): Promise<boolean> => {
      setError(null);
      const signer = pickSignerWallet(wallets, ownerAddress);
      if (!signer) {
        setError(missingSignerMessage(ownerAddress));
        return false;
      }
      const amount = computeOnrampAmount(deficitUsdc);
      writeFundingBreadcrumb({ address: ownerAddress, amountUsdc: amount });
      setPending(true);
      openedAtRef.current = Date.now();
      try {
        await fundWallet({
          address: ownerAddress,
          options: { asset: 'USDC', chain: FUNDING_CHAIN, amount: String(amount) },
        });
        return true;
      } catch {
        setError("Couldn't open funding — try again.");
        return false;
      } finally {
        setPending(false);
        openedAtRef.current = null;
      }
    },
    [fundWallet],
  );

  const clearError = useCallback(() => setError(null), []);
  return { addFunds, pending, error, clearError };
}
