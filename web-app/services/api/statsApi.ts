import { getLessonApiBaseUrl } from './config';

export interface PublicStatsActivity {
  type: 'joined' | 'started_course' | 'finished_course' | 'arena_win' | 'pot_payout';
  wallet: string;
  courseTitle: string | null;
  at: string;
}

export interface PublicStats {
  generatedAt: string;
  people: { totalUsers: number; activeLast7Days: number };
  learning: {
    enrollments: number;
    lessonsCompleted: number;
    coursesCompleted: number;
    totalXp: number;
    activeStreaks: number;
    longestActiveStreak: number;
  };
  money: {
    usdcLocked: string | null;
    activeLocks: number | null;
    learnersEarningYield: number | null;
    currentApyBps: number | null;
    potForfeitedUsdc: string;
    potPaidOutUsdc: string;
    potRecipients: number;
  };
  arena: {
    matchesPlayed: number;
    players: number;
    season: { name: string; endsAt: string | null } | null;
  };
  activity: PublicStatsActivity[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isUsdc(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d{6}$/.test(value);
}

function isPublicStats(value: unknown): value is PublicStats {
  if (!isRecord(value)) return false;
  const { people, learning, money, arena, activity } = value;
  if (!isRecord(people) || !isRecord(learning) || !isRecord(money) || !isRecord(arena)) {
    return false;
  }

  return isTimestamp(value.generatedAt)
    && [people.totalUsers, people.activeLast7Days,
      learning.enrollments, learning.lessonsCompleted, learning.coursesCompleted,
      learning.totalXp, learning.activeStreaks, learning.longestActiveStreak,
      money.potRecipients, arena.matchesPlayed, arena.players].every(isCount)
    && (money.usdcLocked === null || isUsdc(money.usdcLocked))
    && (money.activeLocks === null || isCount(money.activeLocks))
    && (money.learnersEarningYield === null || isCount(money.learnersEarningYield))
    && (money.currentApyBps === null || (typeof money.currentApyBps === 'number'
      && Number.isSafeInteger(money.currentApyBps)))
    && isUsdc(money.potForfeitedUsdc)
    && isUsdc(money.potPaidOutUsdc)
    && (arena.season === null || (isRecord(arena.season)
      && typeof arena.season.name === 'string'
      && (arena.season.endsAt === null || isTimestamp(arena.season.endsAt))))
    && Array.isArray(activity) && activity.length <= 20
    && activity.every((item) => isRecord(item)
      && typeof item.type === 'string'
      && ['joined', 'started_course', 'finished_course', 'arena_win', 'pot_payout'].includes(item.type)
      && typeof item.wallet === 'string'
      && (item.courseTitle === null || typeof item.courseTitle === 'string')
      && isTimestamp(item.at));
}

export async function getPublicStats(): Promise<PublicStats> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  // Next.js can drop the fetch signal during stale cache revalidation.
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Stats request timed out after 10 seconds.')), 10_000);
  });

  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(`${getLessonApiBaseUrl()}/v1/stats`, {
          next: { revalidate: 300 },
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`Stats request failed (${response.status}).`);

        const body: unknown = await response.json();
        if (!isPublicStats(body)) throw new Error('Invalid public stats response.');
        return {
          ...body,
          activity: body.activity.filter(({ wallet }) => wallet === 'Player'
            || /^[1-9A-HJ-NP-Za-km-z]{4}…[1-9A-HJ-NP-Za-km-z]{4}$/.test(wallet)),
        };
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
