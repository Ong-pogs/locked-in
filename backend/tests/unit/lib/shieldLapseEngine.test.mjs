import { describe, expect, it } from 'vitest';
import {
  applyLessonDay,
  applyMissDay,
  userYieldBps,
  normalizeState,
  SHIELD_CAP,
} from '../../../src/lib/shieldLapseEngine.mjs';

// A fresh lock: 3 shields, no lapses (spec §4.2 / migration 0041 defaults).
const fresh = () => normalizeState({ shields: SHIELD_CAP });

// Drive a script of 'L' (lesson-day) / 'M' (miss-day) over an initial state.
function run(script, start = fresh()) {
  let s = start;
  for (const day of script) s = day === 'L' ? applyLessonDay(s) : applyMissDay(s);
  return s;
}

describe('userYieldBps (one-mercy tiers)', () => {
  it('maps lapse count to [10000, 5000, 0]', () => {
    expect(userYieldBps(0)).toBe(10_000);
    expect(userYieldBps(1)).toBe(5_000);
    expect(userYieldBps(2)).toBe(0);
    expect(userYieldBps(9)).toBe(0);
    expect(userYieldBps(-1)).toBe(10_000);
  });
});

describe('shield regen', () => {
  it('grants a shield at exactly 3 consecutive lesson-days (and resets the run)', () => {
    // start at cap 3 -> can't observe +1; start below cap.
    let s = normalizeState({ shields: 1, consecutiveLessonDays: 0 });
    s = applyLessonDay(s); // consec 1
    expect(s.shields).toBe(1);
    s = applyLessonDay(s); // consec 2
    expect(s.shields).toBe(1);
    s = applyLessonDay(s); // consec 3 -> +1, reset
    expect(s.shields).toBe(2);
    expect(s.consecutiveLessonDays).toBe(0);
  });

  it('never exceeds the cap', () => {
    const s = run('LLLLLLLLL'); // many lesson-days, start at cap 3
    expect(s.shields).toBe(SHIELD_CAP);
  });
});

describe('miss resets the consecutive run', () => {
  it('a miss zeroes consecutive_lesson_days', () => {
    let s = applyLessonDay(applyLessonDay(fresh())); // consec 2
    expect(s.consecutiveLessonDays).toBe(2);
    s = applyMissDay(s); // shield burns, consec resets
    expect(s.consecutiveLessonDays).toBe(0);
  });
});

describe('shielded day preserves the streak (the known reset bug)', () => {
  it('complete D1, shield-miss D2, complete D3 -> streak 2', () => {
    const s = run('LML');
    expect(s.streak).toBe(2);
    expect(s.shields).toBe(2); // one shield burned on D2
  });
});

describe('alternate-day play MUST eventually lapse (M1 regression)', () => {
  it('L,M,L,M,... depletes shields (never 3 consecutive) then lapses', () => {
    // 3 shields absorb the first 3 misses; the 4th unshielded miss lapses.
    const s = run('LMLMLMLM');
    expect(s.shields).toBe(0);
    expect(s.lapseCount).toBe(1);
    expect(s.lapseOpen).toBe(true);
  });
});

describe('lapse coalescing', () => {
  it('consecutive dark days count as ONE lapse', () => {
    // burn 3 shields, then two dark days -> single lapse.
    let s = run('MMM'); // 3 misses burn all shields
    expect(s.shields).toBe(0);
    expect(s.lapseCount).toBe(0);
    s = applyMissDay(s); // 1st unshielded miss -> lapse opens
    expect(s.lapseCount).toBe(1);
    expect(s.lapseOpen).toBe(true);
    s = applyMissDay(s); // still dark -> NO new lapse
    expect(s.lapseCount).toBe(1);
  });

  it('a lesson-day re-arms lapsing; the next dark spell is a second lapse', () => {
    let s = run('MMMM'); // shields gone + first lapse (count 1, open)
    expect(s.lapseCount).toBe(1);
    s = applyLessonDay(s); // clears lapse_open, streak resumes
    expect(s.lapseOpen).toBe(false);
    s = applyMissDay(s); // shields still 0 -> second lapse
    expect(s.lapseCount).toBe(2);
    expect(userYieldBps(s.lapseCount)).toBe(0);
  });

  it('caps lapse_count at 2', () => {
    let s = run('MMM'); // shields 0
    s = run('MLMLM', s); // lapse, lesson, lapse, lesson, lapse -> would be 3, capped 2
    expect(s.lapseCount).toBe(2);
  });
});
