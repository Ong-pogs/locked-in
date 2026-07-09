import { describe, expect, it } from 'vitest';
import { deriveLockPdaServer } from '../../../src/lib/lockPosition.mjs';
import { deriveLockPda } from '../../../src/lib/claimVoucher.mjs';
import { createHash } from 'node:crypto';

const PROGRAM = 'EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN';
const OWNER = '9wtYy32vK3hxQeFpWLGXYGRZevEXYQQKYGA3vW2nWLxw';

describe('deriveLockPdaServer', () => {
  it('matches the voucher lib PDA for the same (owner, courseId)', () => {
    const courseId = 'test-kitchen';
    const hash = createHash('sha256').update(courseId, 'utf8').digest();
    const fromVoucherLib = deriveLockPda(PROGRAM, OWNER, hash);
    const fromPositionReader = deriveLockPdaServer(PROGRAM, OWNER, courseId);
    expect(fromPositionReader.toBase58()).toBe(fromVoucherLib.toBase58());
  });

  it('matches the known devnet-proven vector', () => {
    expect(deriveLockPdaServer(PROGRAM, OWNER, 'test-kitchen').toBase58()).toBe(
      '6czu6E4765JzjVESkErbDrdXrdXf3xLWsYfSsBKYnhJb',
    );
  });
});
