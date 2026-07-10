// v2 pot-cycle unit tests (pot-cycle ruling 2026-07-10, R14).
//
// Covers: target-window derivation across month boundaries (including
// 23:59:59 UTC on the 1st), the WINDOW_NOT_PAST refusal, the
// computeWeightedPayouts zero-payout filter preserving the exact total, and
// the LockV2Settled log decoder (discriminator + layout pins).

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import {
  derivePreviousUtcMonthWindowId,
  runPotCycle,
} from '../../../src/lib/potCycle.mjs';
import { decodeLockV2SettledFromLogs } from '../../../src/lib/potBridge.mjs';
import { deriveCommunityPotWindowId } from '../../../src/lib/communityPot.mjs';
import { computeWeightedPayouts } from '../../../src/modules/progress/repository.mjs';

const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

describe('derivePreviousUtcMonthWindowId — month boundaries', () => {
  it.each([
    ['mid-month', '2026-07-15T12:00:00.000Z', 202606],
    ['first instant of a month', '2026-07-01T00:00:00.000Z', 202606],
    ['23:59:59 UTC on the 1st', '2026-03-01T23:59:59.000Z', 202602],
    ['January 1st crosses the year', '2026-01-01T00:00:00.000Z', 202512],
    ['last instant of a month', '2026-02-28T23:59:59.999Z', 202601],
    ['December targets November', '2026-12-31T00:00:00.000Z', 202611],
    ['leap-day month', '2028-02-29T10:00:00.000Z', 202801],
  ])('%s: %s -> %i', (_label, iso, expected) => {
    expect(derivePreviousUtcMonthWindowId(new Date(iso))).toBe(expected);
  });

  it('always yields a window strictly before the current month', () => {
    const now = new Date();
    expect(derivePreviousUtcMonthWindowId(now)).toBeLessThan(
      deriveCommunityPotWindowId(now),
    );
  });
});

describe('runPotCycle — WINDOW_NOT_PAST refusal', () => {
  // Stubs make the R6 preflight pass without any RPC; the refusal fires
  // before the advisory lock, any scan, and any send.
  const deps = {
    readPotConfig: async () => ({ authority: 'AUTH' }),
    relayAuthority: () => 'AUTH',
    ensureVaultAta: async () => {
      throw new Error('must never be called under execute=false');
    },
    scanSettleEvents: async () => {
      throw new Error('scan must never run for a refused window');
    },
    recordSettleEvents: async () => {
      throw new Error('record must never run for a refused window');
    },
  };

  it('refuses the current UTC month', async () => {
    const current = deriveCommunityPotWindowId(new Date());
    const result = await runPotCycle({
      windowId: current,
      execute: false,
      log: silentLog,
      deps,
    });
    expect(result).toMatchObject({ ok: false, benign: false, reason: 'WINDOW_NOT_PAST' });
  });

  it('refuses a future month', async () => {
    const future = deriveCommunityPotWindowId(new Date()) + 1;
    const result = await runPotCycle({
      windowId: future,
      execute: false,
      log: silentLog,
      deps,
    });
    expect(result).toMatchObject({ ok: false, benign: false, reason: 'WINDOW_NOT_PAST' });
  });

  it('fails loudly (never auto-initializes) when PotConfig is missing', async () => {
    const result = await runPotCycle({
      windowId: 190001,
      execute: false,
      log: silentLog,
      deps: { ...deps, readPotConfig: async () => null },
    });
    expect(result).toMatchObject({ ok: false, benign: false, reason: 'PREFLIGHT_FAILED' });
    expect(JSON.stringify(result.detail)).toContain('init-community-pot-protocol.mjs');
  });
});

describe('computeWeightedPayouts — zero-payout filter preserves the total', () => {
  function entry(i, weight) {
    return {
      walletAddress: `wallet-${String(i).padStart(2, '0')}`,
      courseId: 'test-kitchen',
      currentStreak: 1,
      principalAmount: weight,
      weight,
    };
  }

  it('equal weights with a dust total: filtered sum equals the exact total', () => {
    const total = 3n;
    const entries = [0, 1, 2, 3, 4].map((i) => entry(i, 1n));
    const payouts = computeWeightedPayouts(total, entries);
    const filtered = payouts.filter((p) => p.payoutAmount > 0n);

    expect(filtered.length).toBe(3); // two zero-payout rows dropped
    expect(filtered.reduce((sum, p) => sum + p.payoutAmount, 0n)).toBe(total);
    // Unfiltered largest-remainder allocation already sums to the total.
    expect(payouts.reduce((sum, p) => sum + p.payoutAmount, 0n)).toBe(total);
  });

  it('extreme weight skew: dropping zero rows never drops money', () => {
    const total = 1_000_001n;
    const entries = [entry(0, 1n), entry(1, 10n ** 12n)];
    const filtered = computeWeightedPayouts(total, entries).filter(
      (p) => p.payoutAmount > 0n,
    );

    expect(filtered.reduce((sum, p) => sum + p.payoutAmount, 0n)).toBe(total);
    for (const p of filtered) {
      expect(p.payoutAmount > 0n).toBe(true);
    }
  });
});

describe('decodeLockV2SettledFromLogs — discriminator + layout', () => {
  const DISCRIMINATOR = createHash('sha256')
    .update('event:LockV2Settled')
    .digest()
    .subarray(0, 8);

  function encodeEvent({ lock, toOwner, toPot, fee, forced }) {
    const buffer = Buffer.alloc(8 + 32 + 8 + 8 + 8 + 1);
    DISCRIMINATOR.copy(buffer, 0);
    lock.toBuffer().copy(buffer, 8);
    buffer.writeBigUInt64LE(toOwner, 40);
    buffer.writeBigUInt64LE(toPot, 48);
    buffer.writeBigUInt64LE(fee, 56);
    buffer.writeUInt8(forced ? 1 : 0, 64);
    return `Program data: ${buffer.toString('base64')}`;
  }

  it('decodes lock(32) + to_owner u64 + to_pot u64 + fee u64 + forced u8', () => {
    const lock = Keypair.generate().publicKey;
    const logs = [
      'Program EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN invoke [1]',
      encodeEvent({ lock, toOwner: 12n, toPot: 3_400_000n, fee: 56n, forced: true }),
      'Program EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN success',
    ];
    expect(decodeLockV2SettledFromLogs(logs)).toEqual([
      {
        lock: lock.toBase58(),
        toOwner: 12n,
        toPot: 3_400_000n,
        fee: 56n,
        forced: true,
      },
    ]);
  });

  it('ignores other events and non-data log lines', () => {
    const other = Buffer.alloc(65);
    createHash('sha256')
      .update('event:SomethingElse')
      .digest()
      .subarray(0, 8)
      .copy(other, 0);
    const logs = [
      'Program log: hello',
      `Program data: ${other.toString('base64')}`,
      'Program data: not-base64!!!!',
    ];
    expect(decodeLockV2SettledFromLogs(logs)).toEqual([]);
  });
});
