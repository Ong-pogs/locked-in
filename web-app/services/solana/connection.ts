import { Connection, clusterApiUrl, type Cluster } from '@solana/web3.js';

const envRpcEndpoint = (process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? '').trim();

// Derived from env (matching app/providers.tsx) — NOT hardcoded, so a mainnet
// build actually reports mainnet (gates the test-faucet UI, cluster tags, and
// the clusterApiUrl fallback). Defaults to devnet for local/staging.
const envCluster = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'devnet').trim();
export const CLUSTER: Cluster =
  envCluster === 'mainnet-beta' || envCluster === 'mainnet'
    ? 'mainnet-beta'
    : envCluster === 'testnet'
      ? 'testnet'
      : 'devnet';
export const RPC_ENDPOINT = envRpcEndpoint || clusterApiUrl(CLUSTER);

export const connection = new Connection(RPC_ENDPOINT, 'confirmed');
