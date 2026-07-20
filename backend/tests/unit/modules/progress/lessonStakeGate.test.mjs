import { describe, expect, it, vi } from 'vitest';
import { assertLessonStakeAccess } from '../../../../src/modules/progress/repository.mjs';

// Product decision (2026-07-21): lessons are NOT free. A wallet must have
// locked a stake on a course before it can start/check/submit that course's
// lessons.
//
// Before this gate, /start|/check|/submit required only a JWT, so anyone could
// complete a course with zero funds — and completion is frozen permanently, so
// assertCourseLockable then refused to EVER let them stake that course. Free
// practice silently burned the ability to stake.
//
// lesson.user_course_enrollments is written in exactly one place
// (enrollActiveLockServerSide) and only after a server-verified ACTIVE on-chain
// lock, so "an enrollment row exists" IS "this wallet staked this course". The
// row survives a claim, which is what keeps post-claim practice replays working.

const fakeClient = (rowCount) => ({
  query: vi.fn().mockResolvedValue({ rowCount, rows: rowCount ? [{ ok: 1 }] : [] }),
});

describe('assertLessonStakeAccess', () => {
  it('allows a wallet that has an enrollment (i.e. staked the course)', async () => {
    const client = fakeClient(1);
    await expect(assertLessonStakeAccess(client, 'WalletA', 'blockchain-wallets')).resolves.toBeUndefined();
    expect(client.query).toHaveBeenCalledOnce();
  });

  it('rejects a wallet with no stake, with a 403 the client can branch on', async () => {
    const client = fakeClient(0);
    await expect(
      assertLessonStakeAccess(client, 'FreeloaderWallet', 'blockchain-wallets'),
    ).rejects.toMatchObject({ statusCode: 403, code: 'COURSE_NOT_LOCKED' });
  });

  it('scopes the check to BOTH the wallet and the course', async () => {
    const client = fakeClient(1);
    await assertLessonStakeAccess(client, 'WalletA', 'defi-how-money-earns');
    const [, params] = client.query.mock.calls[0];
    expect(params).toEqual(['WalletA', 'defi-how-money-earns']);
  });

  it('still allows access after a claim (enrollment persists → practice replays work)', async () => {
    // A claimed course keeps its enrollment row; only the on-chain lock closes.
    const client = fakeClient(1);
    await expect(assertLessonStakeAccess(client, 'WalletA', 'blockchain-wallets')).resolves.toBeUndefined();
  });
});
