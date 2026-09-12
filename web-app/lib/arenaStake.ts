import type { ArenaStakeEntry } from '../types/arena';

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

  if (entry.outcome === 'FORFEIT') {
    return {
      headline: 'Season lost',
      detail:
        'Your staked course keeps half its yield instead of all of it when you claim. '
        + DEPOSIT_SAFE,
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
      detail: `Your staked course keeps all of its yield. ${DEPOSIT_SAFE}`,
      tone: 'good',
    };
  }

  const days = daysRemaining(entry.endsAt);
  const left = days === 1 ? '1 day left' : `${days} days left`;

  if (delta < 0) {
    return {
      headline: `You are behind — ${left}`,
      detail:
        `Down ${Math.abs(delta)} rating across ${matches}. If the season ends here, your staked `
        + `course keeps half its yield instead of all of it. ${DEPOSIT_SAFE}`,
      tone: 'danger',
    };
  }
  if (delta > 0) {
    return {
      headline: `You are ahead — ${left}`,
      detail:
        `Up ${delta} rating across ${matches}. Finish level or better and you keep all your `
        + `yield. ${DEPOSIT_SAFE}`,
      tone: 'good',
    };
  }
  return {
    headline: `Level — ${left}`,
    detail:
      `Level keeps your full yield — only finishing the season behind costs you a tier. ${DEPOSIT_SAFE}`,
    tone: 'neutral',
  };
}
