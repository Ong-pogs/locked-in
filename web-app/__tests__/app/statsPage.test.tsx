import { act, render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from 'next/constants';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StatsPage, { metadata, revalidate } from '@/app/stats/page';
import ActivityTime from '@/app/stats/ActivityTime';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { flowGuardRedirect } from '@/lib/flowGuard';
import { proxy } from '../../proxy';
import { getPublicStats, type PublicStats } from '@/services/api/statsApi';

vi.mock('@/services/api/statsApi', () => ({ getPublicStats: vi.fn() }));

function statsFixture(): PublicStats {
  return {
    generatedAt: '2026-10-04T03:00:00.000Z',
    people: { totalUsers: 1234, activeLast7Days: 345 },
    learning: {
      enrollments: 2345, lessonsCompleted: 12345, coursesCompleted: 678,
      totalXp: 1234567, activeStreaks: 89, longestActiveStreak: 42,
    },
    money: {
      usdcLocked: '1234.560000', activeLocks: 123, learnersEarningYield: 99,
      currentApyBps: 425, potForfeitedUsdc: '1.005000',
      potPaidOutUsdc: '999.995000', potRecipients: 12,
    },
    arena: {
      matchesPlayed: 3456, players: 456,
      season: { name: 'Season 1', endsAt: '2026-10-31T18:00:00.000Z' },
    },
    activity: [
      { type: 'joined', wallet: '7xKX…a9Fq', courseTitle: null, at: '2026-10-04T03:04:45.000Z' },
      { type: 'started_course', wallet: '2abc…defg', courseTitle: 'Solana basics', at: '2026-10-04T03:00:00.000Z' },
      { type: 'started_course', wallet: '3abc…defg', courseTitle: null, at: '2026-10-04T02:59:00.000Z' },
      { type: 'finished_course', wallet: '4abc…defg', courseTitle: 'Wallet safety', at: '2026-10-04T00:05:00.000Z' },
      { type: 'finished_course', wallet: '5abc…defg', courseTitle: null, at: '2026-10-03T00:05:00.000Z' },
      { type: 'arena_win', wallet: '6abc…defg', courseTitle: null, at: '2026-10-02T03:05:00.000Z' },
      { type: 'pot_payout', wallet: '8abc…defg', courseTitle: null, at: '2026-10-01T03:05:00.000Z' },
    ],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-04T03:05:00.000Z'));
  vi.stubEnv('NEXT_PHASE', PHASE_PRODUCTION_SERVER);
  vi.mocked(getPublicStats).mockReset().mockResolvedValue(statsFixture());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function expectStat(label: string, value: string) {
  expect(screen.getByText(label, { selector: 'dt' }).nextElementSibling).toHaveTextContent(value);
}

describe('public stats page', () => {
  it('renders all sections, counts, exact USDC rounding, APY, and season information', async () => {
    render(await StatsPage());
    expect(screen.getByRole('heading', { name: 'LockedIn stats', level: 1 })).toBeInTheDocument();
    for (const name of ['People', 'Learning', 'Money', 'Arena', 'Recent activity']) {
      expect(screen.getByRole('heading', { name, level: 2 })).toBeInTheDocument();
    }
    for (const [label, value] of [
      ['Total users', '1,234'], ['Active this week', '345'],
      ['Course sign-ups', '2,345'], ['Lessons completed', '12,345'],
      ['Courses completed', '678'], ['Total XP', '1,234,567'],
      ['Active streaks', '89'], ['Longest active streak', '42 days'],
      ['USDC locked now', '$1,234.56'], ['Active locks', '123'],
      ['Learners with active locks', '99'], ['Current APY', '4.25%'],
      ['Forfeited to the community pot', '$1.01'], ['Paid out by the pot', '$1,000.00'],
      ['Pot recipients', '12'], ['Matches played', '3,456'], ['Players', '456'],
      ['Current season', 'Season 1'], ['Season ends', 'Oct 31, 2026, 6:00 PM UTC'],
    ]) expectStat(label, value);
    expect(screen.getByText('Updated', { exact: false })).toHaveTextContent('Updated 5 min ago');
    expect(screen.getByText('Updated', { exact: false }).querySelector('time')).toHaveAttribute('datetime', statsFixture().generatedAt);
    expect(getPublicStats).toHaveBeenCalledTimes(1);
  });

  it('keeps large USDC amounts precise and displays zero values as available', async () => {
    const stats = statsFixture();
    stats.people.totalUsers = 0;
    stats.money = {
      usdcLocked: '9007199254740993.125000', activeLocks: 0, learnersEarningYield: 0,
      currentApyBps: 0, potForfeitedUsdc: '0.000001', potPaidOutUsdc: '0.000000', potRecipients: 0,
    };
    vi.mocked(getPublicStats).mockResolvedValue(stats);
    render(await StatsPage());
    expectStat('USDC locked now', '$9,007,199,254,740,993.13');
    expectStat('Total users', '0');
    expectStat('Active locks', '0');
    expectStat('Learners with active locks', '0');
    expectStat('Current APY', '0.00%');
    expectStat('Forfeited to the community pot', '$0.00');
    expectStat('Paid out by the pot', '$0.00');
    expectStat('Pot recipients', '0');
  });

  it('renders each activity phrase in order with the supplied masked wallet and timestamp', async () => {
    render(await StatsPage());
    const items = within(screen.getByRole('region', { name: 'Recent activity' })).getAllByRole('listitem');
    const phrases = [
      'joined LockedIn', 'started Solana basics', 'started a course',
      'finished Wallet safety', 'finished a course', 'won an Arena match',
      'received a community pot payout',
    ];
    expect(items).toHaveLength(phrases.length);
    items.forEach((item, index) => {
      const activity = statsFixture().activity[index];
      expect(item).toHaveTextContent(`${activity.wallet} ${phrases[index]}`);
      expect(item.querySelector('time')).toHaveAttribute('datetime', activity.at);
      expect(item.textContent).not.toContain('$');
    });
  });

  it('shows unavailable data without treating it as zero', async () => {
    const stats = statsFixture();
    Object.assign(stats.money, { usdcLocked: null, activeLocks: null, learnersEarningYield: null, currentApyBps: null });
    stats.arena.season = null;
    vi.mocked(getPublicStats).mockResolvedValue(stats);
    render(await StatsPage());
    for (const label of ['USDC locked now', 'Active locks', 'Learners with active locks', 'Current APY', 'Current season', 'Season ends']) {
      expectStat(label, 'Not available');
    }
    expect(screen.getAllByText('Not available')).toHaveLength(6);
  });

  it('keeps the season name when its end date is unavailable and handles empty activity', async () => {
    const stats = statsFixture();
    stats.arena.season = { name: 'Season 2', endsAt: null };
    stats.activity = [];
    vi.mocked(getPublicStats).mockResolvedValue(stats);
    render(await StatsPage());
    expectStat('Current season', 'Season 2');
    expectStat('Season ends', 'Not available');
    expect(screen.getByText('No activity yet.')).toBeInTheDocument();
  });

  it('renders a friendly build fallback when fetching fails', async () => {
    vi.stubEnv('NEXT_PHASE', PHASE_PRODUCTION_BUILD);
    vi.mocked(getPublicStats).mockRejectedValue(new Error('Backend unavailable'));
    render(await StatsPage());
    expect(screen.getByText('Stats are warming up. Check back in a few minutes.')).toBeInTheDocument();
    expect(screen.queryByText('Updated', { exact: false })).not.toBeInTheDocument();
  });

  it.each([PHASE_PRODUCTION_SERVER, undefined])('propagates fetch errors at runtime with phase %s', async (phase) => {
    vi.stubEnv('NEXT_PHASE', phase);
    const error = new Error('Backend unavailable');
    vi.mocked(getPublicStats).mockRejectedValue(error);
    await expect(StatsPage()).rejects.toBe(error);
  });

  it('exports public metadata and five-minute revalidation', () => {
    expect(revalidate).toBe(300);
    expect(metadata.title).toBe('Stats');
    expect(metadata.description).toEqual(expect.any(String));
    expect(metadata.openGraph).toMatchObject({ title: 'Stats', description: metadata.description });
  });

  it('is public through both guards and discoverable through sitemap and robots', () => {
    const response = proxy(new NextRequest('https://www.lockedin.quest/stats'));
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(flowGuardRedirect({
      pathname: '/stats', walletAddress: null, isAuthenticated: false,
      phase: 'auth', hasActiveLock: false,
    })).toBeNull();
    expect(sitemap().some((entry) => new URL(entry.url).pathname === '/stats')).toBe(true);
    expect(robots().rules).toMatchObject({ allow: expect.arrayContaining(['/stats']) });
  });
});

describe('activity time', () => {
  it.each([
    ['2026-10-04T03:04:45.000Z', 'just now'],
    ['2026-10-04T03:00:00.000Z', '5 min ago'],
    ['2026-10-04T00:05:00.000Z', '3 h ago'],
    ['2026-10-02T03:05:00.000Z', '2 d ago'],
    ['2026-10-04T03:06:00.000Z', 'just now'],
  ])('formats %s as %s', (at, label) => {
    render(<ActivityTime at={at} />);
    expect(screen.getByText(label)).toHaveAttribute('datetime', at);
  });

  it('uses stable UTC server markup and hydrates without mismatches', async () => {
    const at = '2026-10-04T03:00:00.000Z';
    const element = <ActivityTime at={at} />;
    const html = renderToString(element);
    expect(html).toContain('Oct 4, 2026, 3:00 AM UTC');
    vi.setSystemTime(new Date('2026-10-04T06:00:00.000Z'));
    expect(renderToString(element)).toBe(html);
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const onRecoverableError = vi.fn();
    await act(async () => {
      render(element, { container, hydrate: true, onRecoverableError });
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(screen.getByText('3 h ago')).toHaveAttribute('datetime', at);
  });

  it('updates all timestamps each minute and cleans up its shared subscription', () => {
    const { unmount } = render(<>
      <ActivityTime at="2026-10-04T03:00:00.000Z" />
      <ActivityTime at="2026-10-04T03:04:45.000Z" />
    </>);
    expect(vi.getTimerCount()).toBe(1);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByText('6 min ago')).toBeInTheDocument();
    expect(screen.getByText('1 min ago')).toBeInTheDocument();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
