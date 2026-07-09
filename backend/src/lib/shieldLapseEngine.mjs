// v2 shield/lapse engine — pure state transitions (spec §4.2).
//
// Per active lock, per UTC day, exactly one of applyLessonDay / applyMissDay
// runs. A "lesson-day" is a day with >= 1 FIRST-TIME lesson passed; replays and
// practice write nothing (the caller decides that, not this module).
//
// State fields:
//   streak                 current daily streak (paused, not reset, on a shielded miss)
//   shields                0..3 missed-day absorbers
//   lapseCount             0..2, drives the yield-kept bps
//   lapseOpen              a lapse is "open" until a lesson-day re-arms it — this
//                          coalesces consecutive dark days into ONE lapse
//   consecutiveLessonDays  run length toward the next shield (+1 per 3)

export const SHIELD_CAP = 3;
export const SHIELD_REGEN_EVERY = 3;
export const MAX_LAPSE = 2;

// Yield-kept bps by lapse count (one-mercy): [10000, 5000, 0][min(lapse,2)].
// Mirrors settle.rs VALID_YIELD_BPS and claimVoucher.yieldBpsForLapses.
export function userYieldBps(lapseCount) {
  const tiers = [10_000, 5_000, 0];
  const n = Math.max(0, Math.min(Number(lapseCount) || 0, MAX_LAPSE));
  return tiers[n];
}

// Normalize a possibly-partial DB row into a full engine state.
export function normalizeState(state = {}) {
  return {
    streak: Number(state.streak) || 0,
    shields: Number.isFinite(Number(state.shields)) ? Number(state.shields) : SHIELD_CAP,
    lapseCount: Number(state.lapseCount) || 0,
    lapseOpen: Boolean(state.lapseOpen),
    consecutiveLessonDays: Number(state.consecutiveLessonDays) || 0,
  };
}

/**
 * A lesson-day: streak grows, the consecutive run advances (granting a shield
 * every 3), and lapseOpen clears so the next dark spell counts as a fresh lapse.
 */
export function applyLessonDay(state) {
  const s = normalizeState(state);
  let consecutive = s.consecutiveLessonDays + 1;
  let shields = s.shields;
  if (consecutive >= SHIELD_REGEN_EVERY) {
    shields = Math.min(shields + 1, SHIELD_CAP);
    consecutive = 0;
  }
  return {
    streak: s.streak + 1,
    shields,
    lapseCount: s.lapseCount,
    lapseOpen: false,
    consecutiveLessonDays: consecutive,
  };
}

/**
 * A miss-day: if a shield is banked it burns and the streak pauses (unchanged);
 * otherwise the streak breaks and, unless a lapse is already open, lapseCount
 * advances one tier. Either way the consecutive run resets.
 */
export function applyMissDay(state) {
  const s = normalizeState(state);
  if (s.shields > 0) {
    return {
      streak: s.streak, // paused, not reset
      shields: s.shields - 1,
      lapseCount: s.lapseCount,
      lapseOpen: s.lapseOpen,
      consecutiveLessonDays: 0,
    };
  }
  // shields == 0
  let { lapseCount, lapseOpen } = s;
  if (!lapseOpen) {
    lapseCount = Math.min(lapseCount + 1, MAX_LAPSE);
    lapseOpen = true;
  }
  return {
    streak: 0,
    shields: 0,
    lapseCount,
    lapseOpen,
    consecutiveLessonDays: 0,
  };
}
