import type { Metadata } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CozyCard } from '@/components/cozy';
import { getPublicStats, type PublicStatsActivity } from '@/services/api/statsApi';
import ActivityTime from './ActivityTime';

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

function StatCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <CozyCard className="min-w-0">
      <dt className="text-sm text-white/65">{label}</dt>
      <dd className="mt-2 font-mono text-2xl font-bold text-[#FFD580] tabular-nums [overflow-wrap:anywhere]">
        {children}
      </dd>
    </CozyCard>
  );
}

function StatSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`stats-${title.toLowerCase()}`}>
      <h2 id={`stats-${title.toLowerCase()}`} className="mb-3 font-pixel text-xl font-bold text-[#FFD580]">
        {title}
      </h2>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</dl>
    </section>
  );
}

export default async function StatsPage() {
  const stats = await loadStats();
  const season = stats?.arena.season;

  return (
    <div className="min-h-screen bg-[#06060C] px-[18px] pt-12 pb-24 font-sans text-white/65">
      <div className="mx-auto max-w-[1100px]">
        <header className="mb-8">
          <Link href="/village" className="font-pixel-mono text-xs text-[#FFD580] underline focus-visible:outline-2 focus-visible:outline-offset-4">
            Back to the village
          </Link>
          <h1 className="mt-6 font-pixel text-3xl font-bold text-[#FFD580]">LockedIn stats</h1>
          <p className="mt-3 text-sm leading-relaxed">A shared view of learning, commitment, and community progress.</p>
          {stats && <p className="mt-2 text-xs">Updated <ActivityTime at={stats.generatedAt} /></p>}
        </header>

        {stats ? (
          <div className="space-y-8">
            <StatSection title="People">
              <StatCard label="Total users">{formatInteger(stats.people.totalUsers)}</StatCard>
              <StatCard label="Active this week">{formatInteger(stats.people.activeLast7Days)}</StatCard>
            </StatSection>

            <StatSection title="Learning">
              <StatCard label="Course sign-ups">{formatInteger(stats.learning.enrollments)}</StatCard>
              <StatCard label="Lessons completed">{formatInteger(stats.learning.lessonsCompleted)}</StatCard>
              <StatCard label="Courses completed">{formatInteger(stats.learning.coursesCompleted)}</StatCard>
              <StatCard label="Total XP">{formatInteger(stats.learning.totalXp)}</StatCard>
              <StatCard label="Active streaks">{formatInteger(stats.learning.activeStreaks)}</StatCard>
              <StatCard label="Longest active streak">{formatInteger(stats.learning.longestActiveStreak)} days</StatCard>
            </StatSection>

            <StatSection title="Money">
              <StatCard label="USDC locked now">{formatUsdc(stats.money.usdcLocked)}</StatCard>
              <StatCard label="Active locks">{formatInteger(stats.money.activeLocks)}</StatCard>
              <StatCard label="Learners with active locks">{formatInteger(stats.money.learnersEarningYield)}</StatCard>
              <StatCard label="Current APY">
                {stats.money.currentApyBps === null ? unavailable : `${(stats.money.currentApyBps / 100).toFixed(2)}%`}
              </StatCard>
              <StatCard label="Forfeited to the community pot">{formatUsdc(stats.money.potForfeitedUsdc)}</StatCard>
              <StatCard label="Paid out by the pot">{formatUsdc(stats.money.potPaidOutUsdc)}</StatCard>
              <StatCard label="Pot recipients">{formatInteger(stats.money.potRecipients)}</StatCard>
            </StatSection>

            <StatSection title="Arena">
              <StatCard label="Matches played">{formatInteger(stats.arena.matchesPlayed)}</StatCard>
              <StatCard label="Players">{formatInteger(stats.arena.players)}</StatCard>
              <StatCard label="Current season">{season?.name ?? unavailable}</StatCard>
              <StatCard label="Season ends">
                {season?.endsAt ? (
                  <time dateTime={season.endsAt} className="text-base">
                    {new Date(season.endsAt).toLocaleString('en-US', {
                      dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
                    })} UTC
                  </time>
                ) : unavailable}
              </StatCard>
            </StatSection>

            <section aria-labelledby="stats-activity">
              <h2 id="stats-activity" className="mb-3 font-pixel text-xl font-bold text-[#FFD580]">Recent activity</h2>
              <CozyCard>
                {stats.activity.length === 0 ? <p className="text-sm">No activity yet.</p> : (
                  <ul className="divide-y divide-white/10">
                    {stats.activity.map((item, index) => (
                      <li key={`${item.type}-${item.at}-${index}`} className="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:justify-between sm:gap-6">
                        <p className="min-w-0 text-sm leading-relaxed [overflow-wrap:anywhere]">
                          <span className="font-mono text-[#FFD580]">{item.wallet}</span>{' '}{activityPhrase(item)}
                        </p>
                        <span className="shrink-0 text-xs sm:pt-1"><ActivityTime at={item.at} /></span>
                      </li>
                    ))}
                  </ul>
                )}
              </CozyCard>
            </section>
          </div>
        ) : (
          <CozyCard><p className="text-sm">Stats are warming up. Check back in a few minutes.</p></CozyCard>
        )}

        <footer className="mt-8 space-y-3 text-xs leading-relaxed">
          <p>Wallets are shortened to protect privacy. Numbers refresh every few minutes. USDC locked is read directly from the Solana vault.</p>
          <p>LockedIn is in capped mainnet beta and uses unaudited software. APY is variable.{' '}
            <Link href="/risk" className="text-[#FFD580] underline focus-visible:outline-2 focus-visible:outline-offset-4">Read the risks</Link>.
          </p>
        </footer>
      </div>
    </div>
  );
}
