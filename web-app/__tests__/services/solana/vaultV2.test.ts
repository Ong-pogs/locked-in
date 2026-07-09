// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PublicKey } from '@solana/web3.js';

vi.mock('@/services/solana/connection', () => ({
  connection: { getAccountInfo: vi.fn().mockResolvedValue(null) },
  CLUSTER: 'devnet',
}));

// Known-good vectors from the proven devnet flow (sha256 utf8 + seed "lock-v2").
const PROGRAM = new PublicKey('EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN');
const OWNER = '9wtYy32vK3hxQeFpWLGXYGRZevEXYQQKYGA3vW2nWLxw';
const COURSE = 'test-kitchen';
const COURSE_HASH_HEX = 'b4b5842ea67d0398d96b9eb620bddb59d706806594dbb707fa2815b6dcfbc7a4';
const EXPECTED_LOCK_PDA = '6czu6E4765JzjVESkErbDrdXrdXf3xLWsYfSsBKYnhJb';

describe('vaultV2 client', () => {
  let v2: typeof import('@/services/solana/vaultV2');
  beforeEach(async () => {
    vi.resetModules();
    v2 = await import('@/services/solana/vaultV2');
  });

  it('reports no config when env vars are empty', () => {
    expect(v2.hasVaultV2Config()).toBe(false);
  });

  it('hashes courseId as sha256(utf8) matching the backend', async () => {
    const hash = await v2.hashCourseId(COURSE);
    expect(Buffer.from(hash).toString('hex')).toBe(COURSE_HASH_HEX);
  });

  it('derives the lock PDA matching the backend / on-chain seed', async () => {
    const pda = await v2.deriveLockPda(OWNER, COURSE, PROGRAM);
    expect(pda.toBase58()).toBe(EXPECTED_LOCK_PDA);
  });

  it('encodes open_lock_v2 data: disc(8) || course_hash(32)', async () => {
    const hash = await v2.hashCourseId(COURSE);
    const data = v2.encodeOpenLockData(hash);
    expect(data.length).toBe(40);
    expect([...data.subarray(0, 8)]).toEqual([27, 3, 244, 249, 254, 190, 169, 147]);
    expect(data.subarray(8).toString('hex')).toBe(COURSE_HASH_HEX);
  });

  it('encodes lock_funds_v2 data: disc(8) || course_hash(32) || amount(u64 LE)', async () => {
    const hash = await v2.hashCourseId(COURSE);
    const data = v2.encodeLockFundsData(hash, 2_000_000n);
    expect(data.length).toBe(48);
    expect([...data.subarray(0, 8)]).toEqual([151, 43, 254, 68, 70, 208, 150, 164]);
    expect(data.subarray(8, 40).toString('hex')).toBe(COURSE_HASH_HEX);
    expect(data.readBigUInt64LE(40)).toBe(2_000_000n);
  });

  it('encodes claim_v2 data: disc(8) || bps(u16 LE) || expiry(i64 LE)', () => {
    const data = v2.encodeClaimData(10_000, 1_893_456_000);
    expect(data.length).toBe(18);
    expect([...data.subarray(0, 8)]).toEqual([229, 87, 46, 162, 21, 157, 231, 114]);
    expect(data.readUInt16LE(8)).toBe(10_000);
    expect(data.readBigInt64LE(10)).toBe(1_893_456_000n);
  });

  it('throws deriving config/lock without a program id in env', () => {
    expect(() => v2.getProgramId()).toThrow();
  });
});
