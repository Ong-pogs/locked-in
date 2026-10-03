import { PublicKey } from '@solana/web3.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getProgramAccounts, getAccountInfo, appConfig } = vi.hoisted(() => ({
  getProgramAccounts: vi.fn(),
  getAccountInfo: vi.fn(),
  appConfig: { vaultV2ProgramId: 'EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN', solanaRpcUrl: 'http://localhost:8899' },
}));

vi.mock('../../../src/config.mjs', () => ({ appConfig }));
vi.mock('../../../src/lib/db.mjs', () => ({}));
vi.mock('@solana/web3.js', async (importOriginal) => ({
  ...(await importOriginal()),
  Connection: vi.fn(function () { return { getProgramAccounts, getAccountInfo }; }),
}));

const PROGRAM = appConfig.vaultV2ProgramId;
const ALICE = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const BOB = '9wtYy32vK3hxQeFpWLGXYGRZevEXYQQKYGA3vW2nWLxw';
const NULLS = { usdcLocked: null, activeLocks: null, learnersEarningYield: null };
let getVaultV2Stats;

function lock(owner, principal) {
  const data = Buffer.alloc(90);
  Buffer.from('e87b3e01ac6d8cf6', 'hex').copy(data);
  new PublicKey(owner).toBuffer().copy(data, 8);
  data.writeBigUInt64LE(principal, 72);
  return { pubkey: new PublicKey(owner), account: { data, owner: new PublicKey(PROGRAM) } };
}

function config(tvl) {
  const data = Buffer.alloc(364);
  Buffer.from('2d0eabe5ca694778', 'hex').copy(data);
  data.writeBigUInt64LE(tvl, 352);
  return { data, owner: new PublicKey(PROGRAM) };
}

beforeEach(async () => {
  ({ getVaultV2Stats } = await import('../../../src/lib/vaultV2Stats.mjs'));
  appConfig.vaultV2ProgramId = PROGRAM;
  getProgramAccounts.mockReset().mockResolvedValue([]);
  getAccountInfo.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('v2 vault stats', () => {
  it('counts active locks and distinct owners and sums principals with bigint precision', async () => {
    getProgramAccounts.mockResolvedValue([lock(ALICE, 9007199254740993n), lock(ALICE, 1500000n), lock(BOB, 500000n)]);
    expect(await getVaultV2Stats()).toEqual({ usdcLocked: 9007199256740993n, activeLocks: 3, learnersEarningYield: 2 });
    expect(getProgramAccounts).toHaveBeenCalledTimes(1);
    const [programId, options] = getProgramAccounts.mock.calls[0];
    expect(programId.toBase58()).toBe(PROGRAM);
    expect(options).toMatchObject({ filters: [
      { dataSize: 90 },
      { memcmp: { offset: 0, bytes: 'ftMwDDi1nW1' } },
      { memcmp: { offset: 88, bytes: '1' } },
    ] });
    expect(getAccountInfo).not.toHaveBeenCalled();
  });

  it('returns zero totals for a successful empty account scan', async () => {
    expect(await getVaultV2Stats()).toEqual({ usdcLocked: 0n, activeLocks: 0, learnersEarningYield: 0 });
    expect(getAccountInfo).not.toHaveBeenCalled();
  });

  it('falls back to config current_tvl when the account scan is rejected', async () => {
    getProgramAccounts.mockRejectedValue(new Error('Account scan disabled'));
    getAccountInfo.mockResolvedValue(config(9007199254740993n));
    expect(await getVaultV2Stats()).toEqual({ usdcLocked: 9007199254740993n, activeLocks: null, learnersEarningYield: null });
    const [expectedPda] = PublicKey.findProgramAddressSync([Buffer.from('vault-v2b')], new PublicKey(PROGRAM));
    expect(getAccountInfo.mock.calls[0][0].toBase58()).toBe(expectedPda.toBase58());
  });

  it('returns nulls when both RPC reads fail', async () => {
    getProgramAccounts.mockRejectedValue(new Error('Offline'));
    getAccountInfo.mockRejectedValue(new Error('Offline'));
    expect(await getVaultV2Stats()).toEqual(NULLS);
  });

  it.each(['', 'invalid'])('returns nulls without RPC for an unavailable program id', async (programId) => {
    appConfig.vaultV2ProgramId = programId;
    expect(await getVaultV2Stats()).toEqual(NULLS);
    expect(getProgramAccounts).not.toHaveBeenCalled();
    expect(getAccountInfo).not.toHaveBeenCalled();
  });

  it('falls back after a 3.5 second scan deadline and ignores a late scan', async () => {
    vi.useFakeTimers();
    let release;
    getProgramAccounts.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    getAccountInfo.mockResolvedValue(config(1500000n));
    const settled = vi.fn();
    const read = getVaultV2Stats().then(settled);
    await vi.advanceTimersByTimeAsync(3_500);
    expect(settled).toHaveBeenCalledWith({ usdcLocked: 1500000n, activeLocks: null, learnersEarningYield: null });
    await read;
    release([lock(ALICE, 9000000n)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a stalled fallback read to five seconds', async () => {
    vi.useFakeTimers();
    getProgramAccounts.mockRejectedValue(new Error('Unavailable'));
    getAccountInfo.mockReturnValue(new Promise(() => {}));
    const settled = vi.fn();
    const read = getVaultV2Stats().then(settled);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(settled).toHaveBeenCalledWith(NULLS);
    await read;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['length', 'discriminator', 'owner'])('rejects a malformed fallback account: %s', async (kind) => {
    getProgramAccounts.mockRejectedValue(new Error('Unavailable'));
    const account = config(1500000n);
    if (kind === 'length') account.data = account.data.subarray(0, 352);
    if (kind === 'discriminator') account.data.fill(0, 0, 8);
    if (kind === 'owner') account.owner = new PublicKey(ALICE);
    getAccountInfo.mockResolvedValue(account);
    expect(await getVaultV2Stats()).toEqual(NULLS);
  });
});
