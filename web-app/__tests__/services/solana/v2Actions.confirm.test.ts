// @vitest-environment node
// A tx that lands late must never read as a failure: the user retries and signs
// a second claim against an already-closed lock. These pin the three outcomes
// confirmation can have — landed, definitely-not-landed, still-pending.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const getSignatureStatuses = vi.fn();
const getBlockHeight = vi.fn();

vi.mock('@/services/solana/connection', () => ({
  connection: {
    getSignatureStatuses: (...args: unknown[]) => getSignatureStatuses(...args),
    getBlockHeight: (...args: unknown[]) => getBlockHeight(...args),
  },
  CLUSTER: 'devnet',
}));

const SIG = '5'.repeat(87);
const status = (value: unknown) => ({ value: [value] });

describe('confirmSignature', () => {
  let actions: typeof import('@/services/solana/v2Actions');
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    getSignatureStatuses.mockReset();
    getBlockHeight.mockReset().mockResolvedValue(100);
    actions = await import('@/services/solana/v2Actions');
  });

  type Settled = { ok: true; e: null } | { ok: false; e: unknown };
  const UNSETTLED: Settled | null = null;

  // Drives the poll loop's setTimeout without waiting real seconds.
  async function run(promise: Promise<unknown>): Promise<Settled> {
    const settled: Promise<Settled> = promise.then(
      () => ({ ok: true as const, e: null }),
      (e: unknown) => ({ ok: false as const, e }),
    );
    for (let i = 0; i < 2_000; i += 1) {
      await vi.advanceTimersByTimeAsync(1_000);
      const raced = await Promise.race([settled, Promise.resolve(UNSETTLED)]);
      if (raced !== null) return raced;
    }
    throw new Error('confirmSignature never settled');
  }

  it('resolves once the signature reaches confirmed', async () => {
    getSignatureStatuses
      .mockResolvedValueOnce(status(null))
      .mockResolvedValue(status({ confirmationStatus: 'confirmed', err: null }));
    const result = await run(actions.confirmSignature(SIG, 200));
    expect(result.ok).toBe(true);
  });

  it('throws a plain failure when the tx errored on-chain', async () => {
    getSignatureStatuses.mockResolvedValue(status({ err: { InstructionError: [0, 'X'] } }));
    const result = await run(actions.confirmSignature(SIG, 200));
    expect(result.ok).toBe(false);
    expect(actions.isPendingConfirmation(result.e)).toBe(false);
    expect((result.e as Error).message).toContain('Transaction failed');
  });

  // Past lastValidBlockHeight the blockhash can no longer be included, so a
  // still-unknown signature definitively did not land — retrying is safe.
  it('reports expiry (not pending) once the blockhash is past its last valid height', async () => {
    getSignatureStatuses.mockResolvedValue(status(null));
    getBlockHeight.mockResolvedValue(201);
    const result = await run(actions.confirmSignature(SIG, 200));
    expect(result.ok).toBe(false);
    expect(actions.isPendingConfirmation(result.e)).toBe(false);
    expect((result.e as Error).message).toContain('expired');
  });

  // No block-height signal (RPC refused) → we cannot claim it failed. Surface
  // pending with the signature so the UI says "still confirming", not "failed".
  it('surfaces a distinguishable pending state carrying the signature on timeout', async () => {
    getSignatureStatuses.mockResolvedValue(status(null));
    getBlockHeight.mockRejectedValue(new Error('rpc down'));
    const result = await run(actions.confirmSignature(SIG, 200));
    expect(result.ok).toBe(false);
    expect(actions.isPendingConfirmation(result.e)).toBe(true);
    expect((result.e as { signature: string }).signature).toBe(SIG);
  });

  it('keeps polling well past the old 30s wall clock', async () => {
    getSignatureStatuses.mockResolvedValue(status(null));
    getBlockHeight.mockRejectedValue(new Error('rpc down'));
    const started = Date.now();
    await run(actions.confirmSignature(SIG, 200));
    expect(Date.now() - started).toBeGreaterThan(60_000);
  });
});
