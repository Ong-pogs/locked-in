import { describe, it, expect } from 'vitest';
import {
  detectCluster,
  collectBootGuardViolations,
  assertBootGuards,
  MIN_SECRET_BYTES,
} from '../../../src/lib/bootGuards.mjs';

const LONG_SECRET = 'x'.repeat(48);
const SHORT_SECRET = 'dev-only-please-change'; // 22 bytes — the config fallback

// A config that passes every guard on every cluster, used as the baseline
// each test perturbs. Mirrors the appConfig shape (bootGuards must stay pure
// and read only these fields).
function cleanConfig(overrides = {}) {
  return {
    solanaRpcUrl: 'https://api.devnet.solana.com',
    jwtSecret: LONG_SECRET,
    schedulerSecret: LONG_SECRET,
    vaultV2ProgramId: '',
    lockVaultWorkerPrivateKey: '',
    yieldStrategyEnabled: false,
    yieldStrategyKind: 'fixed_apy_v1',
    yieldStrategyProfile: null,
    deployerKeyPresent: false,
    lockVaultUsdcMint: '',
    ...overrides,
  };
}

const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const CANONICAL_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

describe('collectBootGuardViolations — (d) upgrade key off the backend', () => {
  it('flags DEPLOYER_PRIVATE_KEY present on a mainnet host', () => {
    const v = collectBootGuardViolations(
      cleanConfig({ solanaRpcUrl: MAINNET_RPC, deployerKeyPresent: true, lockVaultUsdcMint: CANONICAL_USDC }),
    );
    expect(v.some((x) => x.includes('DEPLOYER_PRIVATE_KEY'))).toBe(true);
  });
  it('allows the deployer key on devnet', () => {
    const v = collectBootGuardViolations(cleanConfig({ deployerKeyPresent: true }));
    expect(v.some((x) => x.includes('DEPLOYER_PRIVATE_KEY'))).toBe(false);
  });
});

describe('collectBootGuardViolations — (e) real yield behind non-mainnet RPC', () => {
  it('flags kamino_usdc_mainnet behind a devnet RPC (forgotten SOLANA_RPC_URL)', () => {
    const v = collectBootGuardViolations(cleanConfig({ yieldStrategyProfile: 'kamino_usdc_mainnet' }));
    expect(v.some((x) => x.includes('kamino_usdc_mainnet'))).toBe(true);
  });
  it('passes kamino_usdc_mainnet on a real mainnet RPC', () => {
    const v = collectBootGuardViolations(
      cleanConfig({ solanaRpcUrl: MAINNET_RPC, yieldStrategyProfile: 'kamino_usdc_mainnet', lockVaultUsdcMint: CANONICAL_USDC }),
    );
    expect(v.some((x) => x.includes('kamino_usdc_mainnet'))).toBe(false);
  });
});

describe('collectBootGuardViolations — (f) canonical USDC mint on mainnet', () => {
  it('flags a non-canonical mint on mainnet', () => {
    const v = collectBootGuardViolations(
      cleanConfig({ solanaRpcUrl: MAINNET_RPC, lockVaultUsdcMint: 'So11111111111111111111111111111111111111112' }),
    );
    expect(v.some((x) => x.includes('canonical USDC'))).toBe(true);
  });
  it('accepts the canonical mint on mainnet', () => {
    const v = collectBootGuardViolations(
      cleanConfig({ solanaRpcUrl: MAINNET_RPC, lockVaultUsdcMint: CANONICAL_USDC }),
    );
    expect(v.some((x) => x.includes('canonical USDC'))).toBe(false);
  });
});

describe('detectCluster', () => {
  it('detects devnet from the RPC URL', () => {
    expect(detectCluster('https://api.devnet.solana.com')).toBe('devnet');
    expect(detectCluster('https://devnet.helius-rpc.com/?api-key=x')).toBe('devnet');
  });

  it('detects mainnet from the RPC URL', () => {
    expect(detectCluster('https://api.mainnet-beta.solana.com')).toBe('mainnet');
    expect(detectCluster('https://mainnet.helius-rpc.com/?api-key=x')).toBe('mainnet');
  });

  it('detects local RPC endpoints', () => {
    expect(detectCluster('http://127.0.0.1:8899')).toBe('local');
    expect(detectCluster('http://localhost:8899')).toBe('local');
    expect(detectCluster('http://0.0.0.0:8899')).toBe('local');
    expect(detectCluster('http://[::1]:8899')).toBe('local');
  });

  it('matches local hosts exactly — a lookalike hostname is not local', () => {
    expect(detectCluster('https://notlocalhost.example.com')).toBe('unknown');
    expect(detectCluster('https://localhost.evil.com')).toBe('unknown');
  });

  it('classifies an ambiguous devnet+mainnet URL as mainnet (fail closed)', () => {
    expect(detectCluster('https://devnet-gateway.mainnet-proxy.example.com')).toBe('mainnet');
  });

  it('returns unknown for anything else (treated as strictly as mainnet)', () => {
    expect(detectCluster('https://rpc.example.com')).toBe('unknown');
    expect(detectCluster('')).toBe('unknown');
    expect(detectCluster(undefined)).toBe('unknown');
  });
});

describe('collectBootGuardViolations — (a) secret length floor', () => {
  it('flags secrets shorter than 32 bytes on mainnet', () => {
    const violations = collectBootGuardViolations(
      cleanConfig({
        solanaRpcUrl: 'https://api.mainnet-beta.solana.com',
        jwtSecret: SHORT_SECRET,
        schedulerSecret: SHORT_SECRET,
      }),
    );
    expect(violations.some((v) => v.includes('JWT_SECRET'))).toBe(true);
    expect(violations.some((v) => v.includes('SCHEDULER_SECRET'))).toBe(true);
  });

  it('flags short secrets on unknown clusters (fail closed)', () => {
    const violations = collectBootGuardViolations(
      cleanConfig({ solanaRpcUrl: 'https://rpc.example.com', jwtSecret: SHORT_SECRET }),
    );
    expect(violations.some((v) => v.includes('JWT_SECRET'))).toBe(true);
  });

  it('flags short secrets on devnet too — internet-facing devnet moves voucher state (sweep ruling R21)', () => {
    const violations = collectBootGuardViolations(
      cleanConfig({ jwtSecret: SHORT_SECRET, schedulerSecret: SHORT_SECRET }),
    );
    expect(violations.some((v) => v.includes('JWT_SECRET'))).toBe(true);
    expect(violations.some((v) => v.includes('SCHEDULER_SECRET'))).toBe(true);
  });

  it('allows short secrets on local only', () => {
    const violations = collectBootGuardViolations(
      cleanConfig({
        solanaRpcUrl: 'http://127.0.0.1:8899',
        jwtSecret: SHORT_SECRET,
        schedulerSecret: SHORT_SECRET,
      }),
    );
    expect(violations).toEqual([]);
  });

  it('uses byte length, not character count', () => {
    // 31 multibyte chars > 32 bytes — must pass; 31 ASCII chars must fail.
    const multibyte = 'é'.repeat(31); // 62 bytes
    const ascii31 = 'a'.repeat(MIN_SECRET_BYTES - 1);
    const mainnet = { solanaRpcUrl: 'https://api.mainnet-beta.solana.com' };
    expect(
      collectBootGuardViolations(cleanConfig({ ...mainnet, jwtSecret: multibyte })),
    ).toEqual([]);
    expect(
      collectBootGuardViolations(cleanConfig({ ...mainnet, jwtSecret: ascii31 })).length,
    ).toBeGreaterThan(0);
  });
});

describe('collectBootGuardViolations — (b) mainnet vaultV2 vs mock yield', () => {
  const mainnetV2 = {
    solanaRpcUrl: 'https://api.mainnet-beta.solana.com',
    vaultV2ProgramId: 'EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN',
    lockVaultWorkerPrivateKey: 'some-worker-key',
  };

  it('refuses vaultV2 on mainnet with the mock fixed-APY adapter', () => {
    const violations = collectBootGuardViolations(
      cleanConfig({ ...mainnetV2, yieldStrategyEnabled: true, yieldStrategyKind: 'fixed_apy_v1' }),
    );
    expect(violations.some((v) => /mock|devnet/i.test(v))).toBe(true);
  });

  it.each(['fixed_apy_dev', 'kamino_surfpool', 'kamino_devnet_demo'])(
    'refuses vaultV2 on mainnet with the dev/demo profile %s',
    (profile) => {
      const violations = collectBootGuardViolations(
        cleanConfig({
          ...mainnetV2,
          yieldStrategyEnabled: true,
          yieldStrategyKind: 'kamino_klend_reserve_v1',
          yieldStrategyProfile: profile,
        }),
      );
      expect(violations.some((v) => /mock|devnet|demo|surfpool/i.test(v))).toBe(true);
    },
  );

  it('allows vaultV2 on mainnet with the real kamino mainnet profile', () => {
    const violations = collectBootGuardViolations(
      cleanConfig({
        ...mainnetV2,
        yieldStrategyEnabled: true,
        yieldStrategyKind: 'kamino_klend_reserve_v1',
        yieldStrategyProfile: 'kamino_usdc_mainnet',
      }),
    );
    expect(violations).toEqual([]);
  });

  // Hole found in the mainnet-transition audit (S3): with yield vars simply
  // ABSENT the old guard was silent, and /v1/yield/current-apy served the
  // simulated 8% labeled "· mainnet". Real custody must never pair with a
  // silently-disabled yield strategy.
  it('refuses vaultV2 on mainnet with the yield strategy disabled/unset', () => {
    const violations = collectBootGuardViolations(
      cleanConfig({ ...mainnetV2, yieldStrategyEnabled: false }),
    );
    expect(violations.some((v) => /disabled|unset/i.test(v))).toBe(true);
  });

  it('allows the mock adapter on devnet even with vaultV2 configured', () => {
    const violations = collectBootGuardViolations(
      cleanConfig({
        vaultV2ProgramId: 'EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN',
        lockVaultWorkerPrivateKey: 'some-worker-key',
        yieldStrategyEnabled: true,
        yieldStrategyKind: 'fixed_apy_v1',
      }),
    );
    expect(violations).toEqual([]);
  });

  it('does not flag mainnet mock yield when vaultV2 is not configured', () => {
    const violations = collectBootGuardViolations(
      cleanConfig({
        solanaRpcUrl: 'https://api.mainnet-beta.solana.com',
        yieldStrategyEnabled: true,
        yieldStrategyKind: 'fixed_apy_v1',
      }),
    );
    expect(violations).toEqual([]);
  });
});

describe('collectBootGuardViolations — (c) worker key required with vaultV2', () => {
  it('flags a configured vaultV2 program without a worker key, on any cluster', () => {
    for (const solanaRpcUrl of [
      'https://api.devnet.solana.com',
      'https://api.mainnet-beta.solana.com',
      'http://127.0.0.1:8899',
    ]) {
      const violations = collectBootGuardViolations(
        cleanConfig({
          solanaRpcUrl,
          vaultV2ProgramId: 'EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN',
          lockVaultWorkerPrivateKey: '',
        }),
      );
      expect(
        violations.some((v) => v.includes('LOCK_VAULT_WORKER_PRIVATE_KEY')),
        `expected violation for ${solanaRpcUrl}`,
      ).toBe(true);
    }
  });

  it('passes when both the program id and the worker key are set', () => {
    const violations = collectBootGuardViolations(
      cleanConfig({
        vaultV2ProgramId: 'EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN',
        lockVaultWorkerPrivateKey: 'some-worker-key',
      }),
    );
    expect(violations).toEqual([]);
  });
});

describe('assertBootGuards', () => {
  it('throws one error listing every violation', () => {
    const config = cleanConfig({
      solanaRpcUrl: 'https://api.mainnet-beta.solana.com',
      jwtSecret: SHORT_SECRET,
      vaultV2ProgramId: 'EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN',
      lockVaultWorkerPrivateKey: '',
    });
    let error;
    try {
      assertBootGuards(config);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('JWT_SECRET');
    expect(error.message).toContain('LOCK_VAULT_WORKER_PRIVATE_KEY');
  });

  it('does not throw on a clean config', () => {
    expect(() => assertBootGuards(cleanConfig())).not.toThrow();
  });
});
