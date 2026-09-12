// Stake-season rules — pure, no I/O.
//
// Spec: docs/superpowers/specs/2026-09-12-arena-staking-design.md
//
// WHY THE OUTCOME READS A SUMMED DELTA AND NOT A RATING
//
// maybeSettleMatch applies Elo to every COMPLETE match regardless of origin,
// and the repeat-opponent damper resets every 24 hours. Scoring a season on
// global rating would let an accomplice pump a staked wallet with one link
// loss a day at full K. Only matches linked to the season, and only those
// still counted, move the number this file reads.

export const MAX_STAKED_MEETINGS_PER_PAIR = 2;

/**
 * The season's verdict for one entry.
 *
 * lockLive is read fresh from the chain at settle time. A lock that closed
 * mid-season voids: there is no position left to take a tier from, and the
 * owner has already claimed at whatever tier was signed.
 *
 * A null/NaN delta means nothing counted, which is KEPT. This fails safe on
 * purpose — the only direction an unknown may resolve is "no penalty".
 */
export function seasonOutcome({ stakedDelta, lockLive }) {
  if (!lockLive) return 'VOID';
  const delta = Number(stakedDelta);
  if (!Number.isFinite(delta)) return 'KEPT';
  return delta < 0 ? 'FORFEIT' : 'KEPT';
}

/** Tiers this outcome costs the backing lock. Only a FORFEIT costs anything. */
export function penaltyTiersFor(outcome) {
  return outcome === 'FORFEIT' ? 1 : 0;
}

/**
 * Whether a staked match between this pair still moves the season.
 *
 * At a three-wallet population a colluding pair IS the population, so the
 * honest control is narrow: the third and later meetings in one season are
 * recorded but contribute nothing.
 */
export function shouldCountMatch(priorCountedMeetings) {
  const n = Number(priorCountedMeetings);
  if (!Number.isFinite(n) || n < 0) return true;
  return n < MAX_STAKED_MEETINGS_PER_PAIR;
}
