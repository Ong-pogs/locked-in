import { describe, it, expect, vi } from 'vitest';
import { executeDripFlow } from '../../../src/lib/solDrip.mjs';

// In-memory stand-in for the Postgres store. `reserveAndCount` mirrors the
// real semantics: null id = wallet already has a row; total counts rows
// INCLUDING the fresh reservation.
function makeDeps({ reserveId = 'res-1', total = 1, transferImpl } = {}) {
  return {
    reserveAndCount: vi.fn(async () => ({ id: reserveId, total })),
    record: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
    transfer: vi.fn(transferImpl ?? (async () => ({ signature: 'sig-abc' }))),
  };
}

const WALLET = 'FakeWallet1111111111111111111111111111111111';

describe('executeDripFlow', () => {
  it('drips once: reserves, transfers, records the signature', async () => {
    const deps = makeDeps();
    const result = await executeDripFlow({
      walletAddress: WALLET,
      lamports: 5_000_000,
      maxDrips: 200,
      ...deps,
    });
    expect(result).toEqual({ status: 'dripped', signature: 'sig-abc', lamports: 5_000_000 });
    expect(deps.transfer).toHaveBeenCalledTimes(1);
    expect(deps.transfer).toHaveBeenCalledWith(WALLET, 5_000_000);
    expect(deps.record).toHaveBeenCalledWith('res-1', 'sig-abc', 5_000_000);
    expect(deps.release).not.toHaveBeenCalled();
  });

  it('is idempotent: a wallet with an existing row never transfers again', async () => {
    const deps = makeDeps({ reserveId: null });
    const result = await executeDripFlow({
      walletAddress: WALLET,
      lamports: 5_000_000,
      maxDrips: 200,
      ...deps,
    });
    expect(result).toEqual({ status: 'already_dripped' });
    expect(deps.transfer).not.toHaveBeenCalled();
    expect(deps.record).not.toHaveBeenCalled();
    expect(deps.release).not.toHaveBeenCalled();
  });

  it('already_dripped wins over the cap (an existing wallet is not miscounted as capped)', async () => {
    const deps = makeDeps({ reserveId: null, total: 9999 });
    const result = await executeDripFlow({
      walletAddress: WALLET,
      lamports: 5_000_000,
      maxDrips: 200,
      ...deps,
    });
    expect(result).toEqual({ status: 'already_dripped' });
    expect(deps.transfer).not.toHaveBeenCalled();
  });

  it('allows the drip that lands exactly on the cap', async () => {
    // total includes the fresh reservation: 200th drip with maxDrips=200 is ok.
    const deps = makeDeps({ total: 200 });
    const result = await executeDripFlow({
      walletAddress: WALLET,
      lamports: 5_000_000,
      maxDrips: 200,
      ...deps,
    });
    expect(result.status).toBe('dripped');
  });

  it('refuses past the cap: releases the reservation, never transfers', async () => {
    const deps = makeDeps({ total: 201 });
    const result = await executeDripFlow({
      walletAddress: WALLET,
      lamports: 5_000_000,
      maxDrips: 200,
      ...deps,
    });
    expect(result).toEqual({ status: 'cap_reached' });
    expect(deps.release).toHaveBeenCalledWith('res-1');
    expect(deps.transfer).not.toHaveBeenCalled();
    expect(deps.record).not.toHaveBeenCalled();
  });

  it('releases the reservation and rethrows when the transfer fails', async () => {
    const deps = makeDeps({
      transferImpl: async () => {
        throw new Error('rpc exploded');
      },
    });
    await expect(
      executeDripFlow({ walletAddress: WALLET, lamports: 5_000_000, maxDrips: 200, ...deps }),
    ).rejects.toThrow('rpc exploded');
    expect(deps.release).toHaveBeenCalledWith('res-1');
    expect(deps.record).not.toHaveBeenCalled();
  });

  it('keeps the reservation when recording the signature fails (fail closed, no double pay)', async () => {
    const deps = makeDeps();
    deps.record = vi.fn(async () => {
      throw new Error('db gone');
    });
    await expect(
      executeDripFlow({ walletAddress: WALLET, lamports: 5_000_000, maxDrips: 200, ...deps }),
    ).rejects.toThrow('db gone');
    // The SOL already left the treasury — the row MUST stay to block a replay.
    expect(deps.release).not.toHaveBeenCalled();
  });

  it('rejects a non-positive lamports amount before touching anything', async () => {
    const deps = makeDeps();
    await expect(
      executeDripFlow({ walletAddress: WALLET, lamports: 0, maxDrips: 200, ...deps }),
    ).rejects.toThrow(/lamports/i);
    expect(deps.reserveAndCount).not.toHaveBeenCalled();
    expect(deps.transfer).not.toHaveBeenCalled();
  });
});
