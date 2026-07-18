// Signer-wallet selection for v2 money actions (claim/deposit).
//
// The transaction is always built for `ownerAddress` (the store walletAddress
// that owns the lock — useAuth picks embedded for Google users, external for
// wallet users). Privy's useWallets() list can contain BOTH wallet types, in
// any order, so signing with wallets[0] asks the wrong wallet to sign for an
// account it never authorized — surfacing as the wallet-standard 4100 error
// "The requested method and/or account has not been authorized by the user."
// Always select the signer by address; callers surface a reconnect message
// when it is absent instead of prompting the wrong wallet.

export function pickSignerWallet<W extends { address: string }>(
  wallets: readonly W[],
  ownerAddress: string,
): W | null {
  return wallets.find((w) => w.address === ownerAddress) ?? null;
}

/** User-facing message when the owning wallet is not connected. */
export function missingSignerMessage(ownerAddress: string): string {
  const tail = ownerAddress.slice(-4);
  return `The wallet that owns this lock (…${tail}) is not connected. Reconnect that wallet and try again.`;
}
