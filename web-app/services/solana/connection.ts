import { Connection, clusterApiUrl, type Cluster } from '@solana/web3.js';

const envRpcEndpoint = (process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? '').trim();

// Derived from env (matching app/providers.tsx) — NOT hardcoded, so a mainnet
// build actually reports mainnet (gates the test-faucet UI, cluster tags, and
// the clusterApiUrl fallback). A recognized explicit cluster wins; otherwise
// derive from the RPC URL so a mainnet RPC with a missing/typo'd cluster env
// still fails closed to mainnet rather than silently to devnet (audit M5).
export function resolveCluster(): Cluster {
  const c = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? '').trim().toLowerCase();
  if (c === 'mainnet-beta' || c === 'mainnet') return 'mainnet-beta';
  if (c === 'testnet') return 'testnet';
  if (c === 'devnet') return 'devnet';
  const rpc = envRpcEndpoint.toLowerCase();
  if (rpc.includes('mainnet')) return 'mainnet-beta';
  if (rpc.includes('testnet')) return 'testnet';
  return 'devnet';
}
export const CLUSTER: Cluster = resolveCluster();

// On mainnet a real RPC is mandatory — the public clusterApiUrl endpoint is
// rate-limited and would break balance reads / sims / tx submission under any
// real traffic (audit M4).
if (CLUSTER === 'mainnet-beta' && !envRpcEndpoint) {
  throw new Error(
    'NEXT_PUBLIC_SOLANA_RPC_URL is required on mainnet-beta — set a paid RPC (Helius/Triton).',
  );
}
export const RPC_ENDPOINT = envRpcEndpoint || clusterApiUrl(CLUSTER);

export const connection = new Connection(RPC_ENDPOINT, 'confirmed');
