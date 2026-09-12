import type { ArenaStakeEntry } from '../types/arena';
import { combinedKeptBps } from '../components/v2/PenaltyBanner';

export type StakeTone = 'neutral' | 'good' | 'danger';

export interface StakeDescription {
  headline: string;
  detail: string;
  tone: StakeTone;
}

// Repeated in every live state on purpose. A player looking at a red "you are
// behind" panel should never have to go and check whether their deposit is at
// risk — the answer is on the same line as the warning.
const DEPOSIT_SAFE = 'Your deposit is never at risk.';

/**
 * What a forfeit would actually cost THIS course, as a pair of percentages.
 *
 * "half its yield" is only true for a player with no lapses. One lapse already
 * puts them at 50%, and a forfeit takes them to nothing — so the copy reads the
 * real ladder rather than quoting a number that is wrong for anyone who has
 * missed a day.
 */
export function penaltyWording(lapseCount: number): string {
  const kept = combinedKeptBps(lapseCount, 0) / 100;
  const after = combinedKeptBps(lapseCount, 1) / 100;
  if (after === 0) return `it keeps none of its yield instead of ${kept}%`;
  return `it keeps ${after}% of its yield instead of ${kept}%`;
}

export function daysRemaining(endsAt: string, now: Date = new Date()): number {
  const ms = new Date(endsAt).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
}

/**
 * Plain-language state of a stake.
 *
 * The amounts involved are currently worth cents, and the opt-in copy says so
 * rather than implying a jackpot — see the panel.
 */
export function describeStake(entry: ArenaStakeEntry): StakeDescription {
  const delta = Number(entry.stakedDelta) || 0;
  const n = entry.matchesCounted;
  const matches = `${n} staked ${n === 1 ? 'match' : 'matches'}`;

  const lapses = Number(entry.lapseCount) || 0;
  const cost = penaltyWording(lapses);

  if (entry.outcome === 'FORFEIT') {
    return {
      headline: 'Season lost',
      detail: `When you claim, ${cost}. ${DEPOSIT_SAFE}`,
      tone: 'danger',
    };
  }
  if (entry.outcome === 'VOID') {
    return {
      headline: 'Season voided',
      detail: `Your lock closed before the season ended, so nothing was taken. ${DEPOSIT_SAFE}`,
      tone: 'good',
    };
  }
  if (entry.outcome === 'KEPT') {
    return {
      headline: 'Season won',
      detail: `Nothing was taken — your staked course keeps its yield. ${DEPOSIT_SAFE}`,
      tone: 'good',
    };
  }

  const days = daysRemaining(entry.endsAt);
  const left = days === 1 ? '1 day left' : `${days} days left`;

  if (delta < 0) {
    return {
      headline: `You are behind — ${left}`,
      detail:
        `Down ${Math.abs(delta)} rating across ${matches}. If the season ends here, ${cost}. `
        + DEPOSIT_SAFE,
      tone: 'danger',
    };
  }
  if (delta > 0) {
    return {
      headline: `You are ahead — ${left}`,
      detail:
        `Up ${delta} rating across ${matches}. Finish level or better and nothing changes. `
        + DEPOSIT_SAFE,
      tone: 'good',
    };
  }
  return {
    headline: `Level — ${left}`,
    detail:
      `Level is safe — only finishing the season behind costs you anything, and then ${cost}. `
      + DEPOSIT_SAFE,
    tone: 'neutral',
  };
}
