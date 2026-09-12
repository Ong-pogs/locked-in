// Settlement end to end: a lost season takes exactly one tier off the voucher
// the loser's course eventually signs, and takes nothing off anyone else's.
//
// The last test in this file is the one the whole feature exists for — it
// decodes the 91 signed bytes and asserts the bps the program will actually
// read. If that says 10000, everything else here is decoration.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { generateTestWallet } from '../../helpers/test-auth.mjs';
import { acquireSuiteLock, releaseSuiteLock } from '../../helpers/suite-lock.mjs';
import { __setLockV2FreshReadOverride, deriveLockPdaServer } from '../../../src/lib/lockPosition.mjs';
import { runArenaSeasonSweep } from '../../../src/lib/arenaSeasonSweep.mjs';
import {
  readArenaPenaltyTiers,
  issueCourseCompletionVoucher,
  persistCompletionVoucher,
  getStoredCompletionVoucher,
} from '../../../src/modules/progress/repository.mjs';
import { effectiveYieldBps } from '../../../src/lib/claimVoucher.mjs';

let app;
let db;
let suiteLock;

const COURSE = 'test-kitchen';
const OTHER_COURSE = 'swaps-and-dexs';
const OTHER_LOCK = 'Lock2222222222222222222222222222222222222';
const SEASON = 909;
const quiet = { log: { error: () => {} } };

// The entry's lock_address must be the REAL derived PDA, not a placeholder:
// in production it comes from readLockV2AccountFresh, and the voucher signer
// looks the penalty up by the PDA it derives itself. A fake address here would
// make the join silently miss and the test would pass while production didn't.
const lockFor = (wallet, courseId = COURSE) =>
  deriveLockPdaServer(process.env.VAULT_V2_PROGRAM_ID, wallet, courseId).toBase58();

const LOCK_START = 1_700_000_000;

const liveLock = (wallet, status = 'ACTIVE', over = {}) => async () => ({
  mismatch: false,
  status,
  principal: status === 'ACTIVE' ? 10_000_000n : 0n,
  lockStartTs: LOCK_START,
  lockAddress: lockFor(wallet),
  ...over,
});

/** A CLOSED season holding one PENDING entry whose counted links sum to delta. */
async function seedClosedSeasonWithEntry(wallet, { stakedDelta, counted = true }) {
  await db.query(
    `insert into arena.seasons (id, starts_at, ends_at, status)
     values ($1, now() - interval '31 days', now() - interval '1 day', 'CLOSED')
     on conflict (id) do update set status = 'CLOSED'`,
    [SEASON],
  );
  await db.query(
    `insert into arena.season_entries
       (stake_season_id, wallet_address, course_id, lock_address, lock_start_ts,
        consent_version, rating_at_start, outcome)
     values ($1, $2, $3, $4, $5, 'v1', 1200, 'PENDING')
     on conflict do nothing`,
    [SEASON, wallet, COURSE, lockFor(wallet), LOCK_START],
  );
  const m = await db.query(
    `insert into arena.matches
       (origin, status, creator, opponent, question_ids, expires_at, resolved_at)
     values ('queue', 'COMPLETE', $1, $2, array['x'], now(), now())
     returning id`,
    [wallet, generateTestWallet()],
  );
  const matchId = m.rows[0].id;
  await db.query(
    `insert into arena.rating_events
       (match_id, wallet_address, rating_before, rating_after, delta)
     values ($1, $2, 1200, $3, $4)`,
    [matchId, wallet, 1200 + stakedDelta, stakedDelta],
  );
  await db.query(
    `insert into arena.season_match_links (stake_season_id, match_id, wallet_address, counted)
     values ($1, $2, $3, $4)`,
    [SEASON, matchId, wallet, counted],
  );
  return matchId;
}

async function entryOf(wallet) {
  const r = await db.query(
    `select outcome, staked_delta, voided_reason, rating_at_end, settled_at
       from arena.season_entries
      where stake_season_id = $1 and wallet_address = $2`,
    [SEASON, wallet],
  );
  return r.rows[0];
}

/** Mark the course complete so a voucher can legitimately be signed for it. */
async function completeCourse(wallet, courseId = COURSE) {
  const lessons = await db.query(
    `select distinct pl.lesson_id
       from lesson.published_modules pm
       join lesson.published_lessons pl
         on pl.module_id = pm.module_id and pl.release_id = pm.release_id
      where pm.course_id = $1`,
    [courseId],
  );
  for (const { lesson_id } of lessons.rows) {
    await db.query(
      `insert into lesson.user_lesson_progress
         (wallet_address, lesson_id, completed, completed_at, updated_at)
       values ($1, $2, true, now(), now())
       on conflict (wallet_address, lesson_id)
       do update set completed = true, completed_at = now(), updated_at = now()`,
      [wallet, lesson_id],
    );
  }
  // The freeze stamp too: getStoredCompletionVoucher serves nothing without it
  // (branch (a)), so a test that only wrote lesson rows would never exercise
  // the stored-and-replayed path.
  await db.query(
    `insert into lesson.user_course_runtime_state
       (wallet_address, course_id, fuel_cap, course_completed_at)
     values ($1, $2, 7, now())
     on conflict (wallet_address, course_id)
     do update set course_completed_at = coalesce(
       lesson.user_course_runtime_state.course_completed_at, now())`,
    [wallet, courseId],
  );
  return lessons.rows.length;
}

beforeAll(async () => {
  suiteLock = await acquireSuiteLock();
  app = await createTestServer();
  db = await import('../../../src/lib/db.mjs');
});

afterAll(async () => {
  __setLockV2FreshReadOverride(null);
  await closeTestServer(app);
  await releaseSuiteLock(suiteLock);
});

describe('season settlement', () => {
  it('a negative staked delta forfeits exactly one tier', async () => {
    const wallet = generateTestWallet();
    await seedClosedSeasonWithEntry(wallet, { stakedDelta: -16 });
    __setLockV2FreshReadOverride(liveLock(wallet));

    await runArenaSeasonSweep(quiet);

    const e = await entryOf(wallet);
    expect(e.outcome).toBe('FORFEIT');
    expect(e.staked_delta).toBe(-16);
    expect(e.settled_at).not.toBeNull();
    expect(await readArenaPenaltyTiers(wallet, COURSE, lockFor(wallet))).toBe(1);
    expect(effectiveYieldBps({ lapseCount: 0, arenaPenaltyTiers: 1 })).toBe(5_000);
  });

  it('a positive staked delta keeps the tier', async () => {
    const wallet = generateTestWallet();
    await seedClosedSeasonWithEntry(wallet, { stakedDelta: 24 });
    __setLockV2FreshReadOverride(liveLock(wallet));

    await runArenaSeasonSweep(quiet);

    expect((await entryOf(wallet)).outcome).toBe('KEPT');
    expect(await readArenaPenaltyTiers(wallet, COURSE, lockFor(wallet))).toBe(0);
  });

  it('an uncounted link contributes nothing — the pair cap actually bites', async () => {
    const wallet = generateTestWallet();
    // The only link is a 3rd-meeting loss, written counted = false.
    await seedClosedSeasonWithEntry(wallet, { stakedDelta: -48, counted: false });
    __setLockV2FreshReadOverride(liveLock(wallet));

    await runArenaSeasonSweep(quiet);

    const e = await entryOf(wallet);
    expect(e.staked_delta).toBe(0);
    expect(e.outcome).toBe('KEPT');
  });

  it('a closed lock voids rather than forfeits', async () => {
    const wallet = generateTestWallet();
    await seedClosedSeasonWithEntry(wallet, { stakedDelta: -48 });
    __setLockV2FreshReadOverride(liveLock(wallet, 'CLOSED'));

    await runArenaSeasonSweep(quiet);

    const e = await entryOf(wallet);
    expect(e.outcome).toBe('VOID');
    expect(e.voided_reason).toBe('LOCK_NOT_ACTIVE');
    // VOID costs nothing. Nobody is penalised retroactively.
    expect(await readArenaPenaltyTiers(wallet, COURSE, lockFor(wallet))).toBe(0);
  });

  it('a relocked position voids rather than inheriting the stake', async () => {
    const wallet = generateTestWallet();
    await seedClosedSeasonWithEntry(wallet, { stakedDelta: -48 });
    // Closed and reopened: the PDA is UNCHANGED (it is derived from owner +
    // course), so only the start timestamp can tell the two positions apart.
    __setLockV2FreshReadOverride(liveLock(wallet, 'ACTIVE', { lockStartTs: LOCK_START + 5000 }));

    await runArenaSeasonSweep(quiet);

    expect((await entryOf(wallet)).outcome).toBe('VOID');
  });

  it('a chain read that cannot be trusted stays PENDING rather than voiding', async () => {
    // A mismatch is an unreadable answer, not "the lock is gone". Settling it
    // as VOID would let one config skew forgive every penalty in the season.
    const wallet = generateTestWallet();
    await seedClosedSeasonWithEntry(wallet, { stakedDelta: -16 });
    __setLockV2FreshReadOverride(async () => ({
      mismatch: true, reason: 'PROGRAM_OWNER_MISMATCH', lockAddress: lockFor(wallet),
    }));

    await runArenaSeasonSweep(quiet);

    expect((await entryOf(wallet)).outcome).toBe('PENDING');
  });

  it('a forfeit does not follow the user into a replacement lock', async () => {
    const wallet = generateTestWallet();
    await seedClosedSeasonWithEntry(wallet, { stakedDelta: -16 });
    __setLockV2FreshReadOverride(liveLock(wallet));
    await runArenaSeasonSweep(quiet);
    expect((await entryOf(wallet)).outcome).toBe('FORFEIT');
    expect(await readArenaPenaltyTiers(wallet, COURSE, lockFor(wallet))).toBe(1);

    // Same PDA, different position. The old lock's consequence is spent with it.
    __setLockV2FreshReadOverride(liveLock(wallet, 'ACTIVE', { lockStartTs: LOCK_START + 9000 }));
    expect(await readArenaPenaltyTiers(wallet, COURSE, lockFor(wallet))).toBe(0);
  });

  it('an unreadable chain leaves the entry PENDING rather than guessing', async () => {
    const wallet = generateTestWallet();
    await seedClosedSeasonWithEntry(wallet, { stakedDelta: -16 });
    __setLockV2FreshReadOverride(async () => { throw new Error('rpc down'); });

    const r = await runArenaSeasonSweep(quiet);

    expect((await entryOf(wallet)).outcome).toBe('PENDING');
    expect(r.failed).toBeGreaterThan(0);
  });

  it('settles exactly once — a second sweep does not re-settle', async () => {
    const wallet = generateTestWallet();
    await seedClosedSeasonWithEntry(wallet, { stakedDelta: -16 });
    __setLockV2FreshReadOverride(liveLock(wallet));

    await runArenaSeasonSweep(quiet);
    const first = await entryOf(wallet);
    await runArenaSeasonSweep(quiet);
    const second = await entryOf(wallet);

    expect(second.outcome).toBe('FORFEIT');
    expect(second.settled_at).toEqual(first.settled_at);
  });

  it("a forfeit on one lock does not touch the wallet's other course", async () => {
    const wallet = generateTestWallet();
    await seedClosedSeasonWithEntry(wallet, { stakedDelta: -16 });
    __setLockV2FreshReadOverride(liveLock(wallet));
    await runArenaSeasonSweep(quiet);

    expect(await readArenaPenaltyTiers(wallet, COURSE, lockFor(wallet))).toBe(1);
    // A different course, a different lock — untouched.
    expect(await readArenaPenaltyTiers(wallet, OTHER_COURSE, OTHER_LOCK)).toBe(0);
  });
});

describe('the penalty reaches the signed bytes', () => {
  it('signs 5000 into the 91-byte message after a FORFEIT, and replays it', async () => {
    const wallet = generateTestWallet();
    await seedClosedSeasonWithEntry(wallet, { stakedDelta: -16 });
    __setLockV2FreshReadOverride(liveLock(wallet));
    await runArenaSeasonSweep(quiet);
    expect((await entryOf(wallet)).outcome).toBe('FORFEIT');

    await completeCourse(wallet);
    const v = await issueCourseCompletionVoucher(wallet, COURSE);

    expect(v.arenaPenaltyTiers).toBe(1);
    expect(v.lapseCount).toBe(0);
    expect(v.bps).toBe(5_000);

    // THE assertion: what the Ed25519 precompile and settle.rs will read.
    // bps sits at offset 81..83 of the 91-byte message (domain 17 + program 32
    // + lock 32). If this is 10000 the feature is a no-op.
    const message = Buffer.from(v.message, 'base64');
    expect(message.length).toBe(91);
    expect(message.readUInt16LE(81)).toBe(5_000);
    // ...and it is a voucher for this wallet's lock on this course.
    expect(message.subarray(49, 81).equals(new PublicKey(v.lock).toBuffer())).toBe(true);

    // Store it, then serve it again: the stored tier is replayed, never
    // recomputed — same bps, byte-for-byte same signature.
    await persistCompletionVoucher(wallet, COURSE, v);
    const again = await getStoredCompletionVoucher(wallet, COURSE, { log: { error: () => {} } });
    expect(again.bps).toBe(5_000);
    expect(again.arenaPenaltyTiers).toBe(1);
    expect(again.signature).toBe(v.signature);
  });

  it('a KEPT season signs the full 10000', async () => {
    const wallet = generateTestWallet();
    await seedClosedSeasonWithEntry(wallet, { stakedDelta: 24 });
    __setLockV2FreshReadOverride(liveLock(wallet));
    await runArenaSeasonSweep(quiet);

    await completeCourse(wallet);
    const v = await issueCourseCompletionVoucher(wallet, COURSE);

    expect(v.arenaPenaltyTiers).toBe(0);
    expect(v.bps).toBe(10_000);
    expect(Buffer.from(v.message, 'base64').readUInt16LE(81)).toBe(10_000);
  });

  it('a forfeit stacks with one lapse to reach 0, and never below it', async () => {
    const wallet = generateTestWallet();
    await seedClosedSeasonWithEntry(wallet, { stakedDelta: -16 });
    __setLockV2FreshReadOverride(liveLock(wallet));
    await runArenaSeasonSweep(quiet);

    await completeCourse(wallet);
    await db.query(
      `insert into lesson.user_course_runtime_state (wallet_address, course_id, fuel_cap, lapse_count)
       values ($1, $2, 7, 1)
       on conflict (wallet_address, course_id) do update set lapse_count = 1`,
      [wallet, COURSE],
    );

    const v = await issueCourseCompletionVoucher(wallet, COURSE);
    expect(v.lapseCount).toBe(1);
    expect(v.arenaPenaltyTiers).toBe(1);
    expect(v.bps).toBe(0);
    expect(Buffer.from(v.message, 'base64').readUInt16LE(81)).toBe(0);
  });
});

// REGRESSION: the realistic order of events.
//
// Every other test here settles the season and THEN completes the course. Real
// users do the opposite — they finish the course while the season is still
// running, which signs a voucher immediately (repository.mjs post-commit
// auto-issue). If the penalty cannot reach a voucher that already exists, the
// entire loser side of this feature is a no-op for anyone who is actually
// studying.
describe('a course completed BEFORE the season settles', () => {
  it('still ends up serving the penalised tier', async () => {
    const wallet = generateTestWallet();
    await seedClosedSeasonWithEntry(wallet, { stakedDelta: -16 });
    __setLockV2FreshReadOverride(liveLock(wallet));

    // Finish the course first, and sign+store a voucher the way the submit
    // path does.
    await completeCourse(wallet);
    const early = await issueCourseCompletionVoucher(wallet, COURSE);
    await persistCompletionVoucher(wallet, COURSE, early);
    expect(early.bps).toBe(10_000); // nothing settled yet — correct so far

    // Now the season settles against them.
    await runArenaSeasonSweep(quiet);
    expect((await entryOf(wallet)).outcome).toBe('FORFEIT');

    // What the client actually gets from here on must carry the penalty.
    const served = await getStoredCompletionVoucher(wallet, COURSE, { log: { error: () => {} } });
    expect(served.arenaPenaltyTiers).toBe(1);
    expect(served.bps).toBe(5_000);
    expect(Buffer.from(served.message, 'base64').readUInt16LE(81)).toBe(5_000);
  });

  it('does not let a later zero-delta season erase the forfeit', async () => {
    const wallet = generateTestWallet();
    await seedClosedSeasonWithEntry(wallet, { stakedDelta: -16 });
    __setLockV2FreshReadOverride(liveLock(wallet));
    await runArenaSeasonSweep(quiet);
    expect((await entryOf(wallet)).outcome).toBe('FORFEIT');

    // A second season, opted into and never played, settles KEPT with a newer
    // settled_at. Reading "the most recent settled entry" would wipe the
    // penalty for free.
    await db.query(
      `insert into arena.seasons (id, starts_at, ends_at, status)
       values (910, now() - interval '10 days', now() - interval '1 hour', 'CLOSED')
       on conflict (id) do update set status = 'CLOSED'`);
    await db.query(
      `insert into arena.season_entries
         (stake_season_id, wallet_address, course_id, lock_address, lock_start_ts,
          consent_version, rating_at_start, outcome)
       values (910, $1, $2, $3, $4, 'v1', 1200, 'PENDING')
       on conflict do nothing`,
      [wallet, COURSE, lockFor(wallet), LOCK_START]);
    await runArenaSeasonSweep(quiet);

    const later = await db.query(
      `select outcome from arena.season_entries
        where stake_season_id = 910 and wallet_address = $1`, [wallet]);
    expect(later.rows[0].outcome).toBe('KEPT');

    // The forfeit still stands.
    expect(await readArenaPenaltyTiers(wallet, COURSE, lockFor(wallet))).toBe(1);
  });
});

describe('the expiry clamp', () => {
  it('never signs a voucher that is already dead', async () => {
    // If the cron has not run since a season ended, clamping to that season
    // would produce an expiry in the past — locking a user out of their own
    // principal because of our scheduling, not their play.
    const wallet = generateTestWallet();
    // Only one season may be OPEN, and earlier tests here leave one behind.
    await db.query(`update arena.seasons set status = 'SETTLED' where status = 'OPEN'`);
    await db.query(
      `insert into arena.seasons (id, starts_at, ends_at, status)
       values (911, now() - interval '40 days', now() - interval '9 days', 'OPEN')
       on conflict (id) do update set status = 'OPEN',
         starts_at = excluded.starts_at, ends_at = excluded.ends_at`);
    await db.query(
      `insert into arena.season_entries
         (stake_season_id, wallet_address, course_id, lock_address, lock_start_ts,
          consent_version, rating_at_start, outcome)
       values (911, $1, $2, $3, $4, 'v1', 1200, 'PENDING')
       on conflict do nothing`,
      [wallet, COURSE, lockFor(wallet), LOCK_START]);

    await completeCourse(wallet);
    const v = await issueCourseCompletionVoucher(wallet, COURSE);

    expect(v.expiry * 1000).toBeGreaterThan(Date.now());
    await db.query(`update arena.seasons set status = 'SETTLED' where id = 911`);
  });
});
