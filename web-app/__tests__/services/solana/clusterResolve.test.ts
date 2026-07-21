import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// connection.ts is the single source of truth for the resolved cluster. The
// frontend used to resolve it in two places (connection.ts + providers.tsx)
// that could disagree; these tests pin the one resolver's contract so a
// mainnet build can never fall back to devnet chrome and vice versa (audit M5).
//
// `envRpcEndpoint` is captured at module load, so each case sets env vars then
// re-imports a fresh module (matching the reset pattern in lockVault.test.ts).

const CLUSTER_KEY = 'NEXT_PUBLIC_SOLANA_CLUSTER';
const RPC_KEY = 'NEXT_PUBLIC_SOLANA_RPC_URL';

let savedCluster: string | undefined;
let savedRpc: string | undefined;

beforeEach(() => {
  savedCluster = process.env[CLUSTER_KEY];
  savedRpc = process.env[RPC_KEY];
  delete process.env[CLUSTER_KEY];
  delete process.env[RPC_KEY];
  vi.resetModules();
});

afterEach(() => {
  if (savedCluster === undefined) delete process.env[CLUSTER_KEY];
  else process.env[CLUSTER_KEY] = savedCluster;
  if (savedRpc === undefined) delete process.env[RPC_KEY];
  else process.env[RPC_KEY] = savedRpc;
});

async function load() {
  return import('@/services/solana/connection');
}

describe('resolveCluster (single source of truth)', () => {
  it('explicit NEXT_PUBLIC_SOLANA_CLUSTER wins over the RPC-URL heuristic', async () => {
    // Var says mainnet while the RPC hostname says devnet — the var must win.
    process.env[CLUSTER_KEY] = 'mainnet-beta';
    process.env[RPC_KEY] = 'https://api.devnet.solana.com';
    const { resolveCluster, CLUSTER } = await load();
    expect(resolveCluster()).toBe('mainnet-beta');
    expect(CLUSTER).toBe('mainnet-beta');
  });

  it("accepts the 'mainnet' alias for mainnet-beta", async () => {
    process.env[CLUSTER_KEY] = 'mainnet';
    process.env[RPC_KEY] = 'https://example-rpc.com';
    const { resolveCluster } = await load();
    expect(resolveCluster()).toBe('mainnet-beta');
  });

  it('explicit devnet wins even when the RPC hostname contains "mainnet"', async () => {
    process.env[CLUSTER_KEY] = 'devnet';
    process.env[RPC_KEY] = 'https://my-mainnet-proxy.example.com';
    const { resolveCluster } = await load();
    expect(resolveCluster()).toBe('devnet');
  });

  it('falls closed to mainnet-beta when the var is unset but the RPC hostname says mainnet', async () => {
    process.env[RPC_KEY] = 'https://rpc.mainnet.example.com';
    const { resolveCluster } = await load();
    expect(resolveCluster()).toBe('mainnet-beta');
  });

  it('resolves an unknown/branded RPC without the var to devnet (documented fail-open default)', async () => {
    // Triton/Helius/custom domains with no "mainnet"/"testnet" token and no
    // cluster var land on devnet. This is why the env template MUST set the
    // cluster var on mainnet; the URL heuristic alone can't recognize a branded
    // host. The test locks this default so a change to it is deliberate.
    process.env[RPC_KEY] = 'https://locked-in.rpcpool.com';
    const { resolveCluster } = await load();
    expect(resolveCluster()).toBe('devnet');
  });

  it('resolves to devnet when nothing is set', async () => {
    const { resolveCluster } = await load();
    expect(resolveCluster()).toBe('devnet');
  });
});
