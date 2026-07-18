import { describe, expect, it } from 'vitest';
import { pickSignerWallet } from '@/services/solana/pickSignerWallet';

// Regression: the claim/deposit pages used to sign with solanaWallets[0] —
// whatever wallet Privy listed first — while the transaction was built for
// walletAddress (the lock owner). When those differed (embedded + external
// wallet both connected), the wallet rejected with the 4100 "requested
// method and/or account has not been authorized by the user" error.

const w = (address: string) => ({ address });

describe('pickSignerWallet', () => {
  it('picks the wallet whose address matches the owner', () => {
    const phantom = w('ExternaLPhantomAddr111111111111111111111111');
    const embedded = w('DeLAgNuTmdW2Qv2HE38yXbi1Jhofhfxb3HHQLXHie344');
    expect(
      pickSignerWallet([phantom, embedded], 'DeLAgNuTmdW2Qv2HE38yXbi1Jhofhfxb3HHQLXHie344'),
    ).toBe(embedded);
  });

  it('returns null when no connected wallet owns the address', () => {
    const phantom = w('ExternaLPhantomAddr111111111111111111111111');
    expect(pickSignerWallet([phantom], 'DeLAgNuTmdW2Qv2HE38yXbi1Jhofhfxb3HHQLXHie344')).toBeNull();
  });

  it('returns null for an empty wallet list', () => {
    expect(pickSignerWallet([], 'DeLAgNuTmdW2Qv2HE38yXbi1Jhofhfxb3HHQLXHie344')).toBeNull();
  });

  it('never falls back to index 0 on mismatch', () => {
    const other = w('SomeOtherWa11etAddr111111111111111111111111');
    expect(pickSignerWallet([other], 'DifferentOwnerAddr1111111111111111111111111')).toBeNull();
  });
});
