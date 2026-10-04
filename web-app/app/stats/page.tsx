import type { Metadata } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import Link from 'next/link';
import { CozyCard, CozySectionLabel, CozyStatBox } from '@/components/cozy';
import { getPublicStats, type PublicStatsActivity } from '@/services/api/statsApi';
import ActivityTime from './ActivityTime';
import { StatsShell } from './StatsShell';

export const revalidate = 300;

const description = 'See community learning progress, active locks, Arena matches, and recent activity on LockedIn.';
export const metadata: Metadata = {
  title: 'Stats',
  description,
  openGraph: { title: 'Stats', description },
};

const integers = new Intl.NumberFormat('en-US');
const unavailable = 'Not available';

async function loadStats() {
  try {
    return await getPublicStats();
  } catch (error) {
    // Allow offline builds; runtime errors must preserve the last good ISR page.
    if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return null;
    throw error;
  }
}

function formatInteger(value: number | null) {
  return value === null ? unavailable : integers.format(value);
}

function formatUsdc(value: string | null) {
  if (value === null) return unavailable;
  const [whole, fraction] = value.split('.');
  // Round half up to cents using base units, without converting USDC to floats.
  const cents = (BigInt(whole) * 1_000_000n + BigInt(fraction) + 5_000n) / 10_000n;
  return `$${integers.format(cents / 100n)}.${String(cents % 100n).padStart(2, '0')}`;
}

function activityPhrase(item: PublicStatsActivity) {
  switch (item.type) {
    case 'joined': return 'joined LockedIn';
    case 'started_course': return `started ${item.courseTitle ?? 'a course'}`;
    case 'finished_course': return `finished ${item.courseTitle ?? 'a course'}`;
    case 'arena_win': return 'won an Arena match';
    case 'pot_payout': return 'received a community pot payout';
  }
}

export default async function StatsPage() {
  const stats = await loadStats();
  const season = stats?.arena.season;

  return (
    <StatsShell>
      <header className="mb-5">
        <h1
          className="text-3xl font-bold tracking-wide mb-1 font-pixel"
          style={{ color: 'var(--stats-accent)', textShadow: 'var(--stats-text-shadow)' }}
        >
          LockedIn stats
        </h1>
        <p className="text-[13px] leading-7" style={{ color: 'var(--stats-muted)' }}>
          A shared view of learning, commitment, and community progress.
        </p>
        {stats && (
          <p
            className="font-pixel-mono text-[10px] uppercase tracking-[1.5px] mt-1"
            style={{ color: 'var(--stats-muted)', textShadow: 'var(--stats-text-shadow)' }}
          >
            Updated <ActivityTime at={stats.generatedAt} />
          </p>
        )}
      </header>

      {stats ? (
        <div className="space-y-5">
          <section aria-label="People">
            <CozySectionLabel as="h2">People</CozySectionLabel>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <CozyStatBox label="Total users" value={formatInteger(stats.people.totalUsers)} />
              <CozyStatBox label="Active this week" value={formatInteger(stats.people.activeLast7Days)} />
            </div>
          </section>

          <section aria-label="Learning">
            <CozySectionLabel as="h2">Learning</CozySectionLabel>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <CozyStatBox label="Course sign-ups" value={formatInteger(stats.learning.enrollments)} />
              <CozyStatBox label="Lessons completed" value={formatInteger(stats.learning.lessonsCompleted)} />
              <CozyStatBox label="Courses completed" value={formatInteger(stats.learning.coursesCompleted)} />
              <CozyStatBox label="Total XP" value={formatInteger(stats.learning.totalXp)} />
              <CozyStatBox label="Active streaks" value={formatInteger(stats.learning.activeStreaks)} />
              <CozyStatBox label="Longest streak" value={formatInteger(stats.learning.longestActiveStreak)} suffix=" days" />
            </div>
          </section>

          <section aria-label="Money">
            <CozySectionLabel as="h2">Money</CozySectionLabel>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <CozyStatBox label="USDC locked" value={formatUsdc(stats.money.usdcLocked)} className="min-w-0 text-center [overflow-wrap:anywhere]" />
              <CozyStatBox label="Active locks" value={formatInteger(stats.money.activeLocks)} />
              <CozyStatBox label="Learners locked in" value={formatInteger(stats.money.learnersEarningYield)} />
              <CozyStatBox
                label="Current APY"
                value={stats.money.currentApyBps === null ? unavailable : `${(stats.money.currentApyBps / 100).toFixed(2)}%`}
              />
              <CozyStatBox label="Forfeited to pot" value={formatUsdc(stats.money.potForfeitedUsdc)} className="min-w-0 text-center [overflow-wrap:anywhere]" />
              <CozyStatBox label="Paid out by pot" value={formatUsdc(stats.money.potPaidOutUsdc)} className="min-w-0 text-center [overflow-wrap:anywhere]" />
              <CozyStatBox label="Pot recipients" value={formatInteger(stats.money.potRecipients)} />
            </div>
          </section>

          <section aria-label="Arena">
            <CozySectionLabel as="h2">Arena</CozySectionLabel>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <CozyStatBox label="Matches played" value={formatInteger(stats.arena.matchesPlayed)} />
              <CozyStatBox label="Players" value={formatInteger(stats.arena.players)} />
              <CozyStatBox label="Season" value={season?.name ?? unavailable} className="min-w-0 text-center [overflow-wrap:anywhere]" />
              <CozyStatBox
                label="Season ends"
                value={season?.endsAt ? `${new Date(season.endsAt).toLocaleString('en-US', {
                  dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
                })} UTC` : unavailable}
                className="min-w-0 text-center [overflow-wrap:anywhere]"
              />
            </div>
          </section>

          <section aria-label="Recent activity">
            <CozySectionLabel as="h2">Recent activity</CozySectionLabel>
            <CozyCard style={{ padding: stats.activity.length === 0 ? 18 : 0, overflow: 'hidden' }}>
              {stats.activity.length === 0 ? (
                <p className="font-pixel-mono text-[12px]" style={{ color: 'var(--stats-muted)' }}>No activity yet.</p>
              ) : (
                <ul>
                  {stats.activity.map((item, index) => (
                    <li
                      key={`${item.type}-${item.at}-${index}`}
                      className="flex min-w-0 flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                      style={{
                        borderBottom: '1px dashed color-mix(in srgb, var(--stats-accent) 10%, transparent)',
                        background: index % 2 === 0 ? 'color-mix(in srgb, var(--stats-accent) 2.5%, transparent)' : 'transparent',
                      }}
                    >
                      <p className="min-w-0 font-mono text-[12px] [overflow-wrap:anywhere]" style={{ color: 'var(--stats-muted)' }}>
                        <span className="font-bold" style={{ color: 'var(--stats-accent)', textShadow: 'var(--stats-text-shadow)' }}>
                          {item.wallet}
                        </span>{' '}{activityPhrase(item)}
                      </p>
                      <span
                        className="shrink-0 font-pixel-mono text-[10px] uppercase tracking-[1px]"
                        style={{ color: 'var(--stats-muted)' }}
                      >
                        <ActivityTime at={item.at} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CozyCard>
          </section>
        </div>
      ) : (
        <CozyCard style={{ padding: 20 }}>
          <p className="font-pixel-mono text-[12px]" style={{ color: 'var(--stats-muted)' }}>
            Stats are warming up. Check back in a few minutes.
          </p>
        </CozyCard>
      )}

      <footer className="mt-8 space-y-3 font-sans text-[13px] leading-[1.7]" style={{ color: 'var(--stats-muted)' }}>
        <p>Wallets are shortened to protect privacy. Numbers refresh every few minutes. USDC locked is read directly from the Solana vault.</p>
        <p>LockedIn is in capped mainnet beta and uses unaudited software. APY is variable.{' '}
          <Link href="/risk" className="underline focus-visible:outline-2 focus-visible:outline-offset-4" style={{ color: 'var(--stats-accent)' }}>Read the risks</Link>.
        </p>
      </footer>
    </StatsShell>
  );
}
