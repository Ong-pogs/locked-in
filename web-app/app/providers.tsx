'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors, useSolanaFundingPlugin } from '@privy-io/react-auth/solana';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';
import { CLUSTER, RPC_ENDPOINT } from '@/services/solana/connection';

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';
// connection.ts is the single source of truth for the resolved cluster (audit
// M5) — re-deriving it here let the Privy chain key drift from the cluster that
// gates the dev UI, cluster tags, and APY suffix. Map the resolved cluster to
// Privy's chain-key slug ('mainnet-beta' → 'mainnet').
const CHAIN_SLUG = CLUSTER === 'mainnet-beta' ? 'mainnet' : CLUSTER;
const RPC_URL = RPC_ENDPOINT;
const WS_URL = process.env.NEXT_PUBLIC_SOLANA_WS_URL ?? `wss://api.${CLUSTER}.solana.com`;

const solanaRpc = createSolanaRpc(RPC_URL);
const solanaRpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);

/**
 * Privy v3 plugin architecture: the fiat-funding UI (used by useFundWallet on
 * the deposit screen's Add-funds flow) is activated by calling this hook once
 * inside the provider tree. Without it, fundWallet() has no modal to open.
 */
export function SolanaFundingBridge() {
  useSolanaFundingPlugin();
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        solana: {
          rpcs: {
            // Privy embedded wallet defaults to mainnet — provide both so it doesn't error.
            // All actual transactions go through the cluster set in NEXT_PUBLIC_SOLANA_CLUSTER.
            'solana:mainnet': {
              rpc: solanaRpc,
              rpcSubscriptions: solanaRpcSubscriptions,
            },
            [`solana:${CHAIN_SLUG}`]: {
              rpc: solanaRpc,
              rpcSubscriptions: solanaRpcSubscriptions,
            },
          },
        },
        appearance: {
          theme: 'dark',
          walletChainType: 'solana-only',
        },
        loginMethods: ['google', 'wallet'],
        externalWallets: {
          solana: {
            connectors: toSolanaWalletConnectors({ shouldAutoConnect: false }),
          },
        },
        embeddedWallets: {
          solana: {
            // Only mint an embedded wallet for users who logged in without
            // one (e.g. Google login). External-wallet users (Phantom)
            // already have a wallet — don't create dead-weight alongside.
            createOnLogin: 'users-without-wallets',
          },
        },
      }}
    >
      <SolanaFundingBridge />
      {children}
    </PrivyProvider>
  );
}
