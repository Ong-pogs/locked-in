// Entry to the Arena requires a live stake, so every test that plays a match
// has to stake its players first.
//
// The entry is inserted directly rather than going through POST /v1/arena/stake
// because that path reads the chain, and these tests are about matches, not
// about eligibility — arenaSeasonOptIn.test.mjs owns the gate itself.
//
// Every file using this shares ONE season id and only ever ensures it is open,
// so they do not fight over which season is live. Files that open and CLOSE
// seasons (the settlement suites) hold the suite lock, and so must anyone
// staking, or a season can be closed out from under a match mid-test.

export const TEST_SEASON_ID = 700;

/** Idempotently make our shared season the open one. */
export async function openTestSeason(db) {
  await db.query(
    `update arena.seasons set status = 'SETTLED'
      where status = 'OPEN' and id <> $1`, [TEST_SEASON_ID]);
  await db.query(
    `insert into arena.seasons (id, starts_at, ends_at, status)
     values ($1, now() - interval '1 hour', now() + interval '29 days', 'OPEN')
     on conflict (id) do update set status = 'OPEN',
       starts_at = excluded.starts_at, ends_at = excluded.ends_at`,
    [TEST_SEASON_ID],
  );
}

/** Give this wallet a live stake so it may enter the Arena. */
export async function stakeForTest(db, wallet, courseId = 'test-kitchen') {
  await openTestSeason(db);
  await db.query(
    `insert into arena.season_entries
       (stake_season_id, wallet_address, course_id, lock_address, lock_start_ts,
        consent_version, rating_at_start, outcome)
     values ($1, $2, $3, $4, 1700000000, 'test', 1200, 'PENDING')
     on conflict (stake_season_id, wallet_address, course_id) do nothing`,
    [TEST_SEASON_ID, wallet, courseId, `TestLock${wallet.slice(0, 20)}`],
  );
  return wallet;
}

/** Stake several wallets at once. Returns them unchanged, for chaining. */
export async function stakeAllForTest(db, wallets, courseId = 'test-kitchen') {
  for (const w of wallets) await stakeForTest(db, w, courseId);
  return wallets;
}

/** A fresh wallet that already holds a live stake — ready to enter the Arena. */
export async function stakedWallet(db, courseId = 'test-kitchen') {
  const { generateTestWallet } = await import('./test-auth.mjs');
  return stakeForTest(db, generateTestWallet(), courseId);
}
