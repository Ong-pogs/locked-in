import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

const useSolanaFundingPlugin = vi.fn();
vi.mock('@privy-io/react-auth/solana', () => ({
  useSolanaFundingPlugin: () => useSolanaFundingPlugin(),
  toSolanaWalletConnectors: () => ({}),
}));
vi.mock('@privy-io/react-auth', () => ({
  PrivyProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@solana/kit', () => ({
  createSolanaRpc: () => ({}),
  createSolanaRpcSubscriptions: () => ({}),
}));
vi.mock('@/services/solana/connection', () => ({
  CLUSTER: 'mainnet-beta',
  RPC_ENDPOINT: 'http://mock',
}));

import { SolanaFundingBridge } from '@/app/providers';

describe('SolanaFundingBridge', () => {
  it('registers the Privy solana funding plugin', () => {
    render(<SolanaFundingBridge />);
    expect(useSolanaFundingPlugin).toHaveBeenCalled();
  });
});
