'use client';

import { useMemo, useState } from 'react';
import { Flame, Sparkles } from 'lucide-react';
import { CozyCard, CozySectionLabel, COZY_TEXT, COZY_TEXT_SHADOW } from '@/components/cozy';
import { T } from '@/components/theme';

// Carried over from the legacy dashboard (user pick, 2026-07-10): XP hero,
// 365-day activity heatmap, journey stats. Cozy-styled to match the v2 surface.

const AMBER = COZY_TEXT; // #FFD580
const SHADOW = COZY_TEXT_SHADOW;
export const LEVEL_NAMES = ['Novice', 'Apprentice', 'Scholar', 'Adept', 'Master', 'Sage', 'Legend'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mon', 'Wed', 'Fri'];
const HEATMAP_LEVEL_BG = [
  'rgba(255,255,255,0.06)',
  'rgba(255,213,128,0.20)',
  'rgba(255,213,128,0.40)',
  'rgba(255,213,128,0.65)',
  'rgba(255,213,128,0.95)',
];

/**
 * Calendar-year buckets: Jan 1 → Dec 31 of `year` (index 0 = Jan 1). Levels
 * 0-4 from completion counts. For the CURRENT year, days after today are
 * marked -1 (future — rendered as empty cells, GitHub-style); past years fill
 * the whole 365/366. `activeToday` forces today's bucket to ≥1, but only when
 * `year` is the current year.
 */
export function buildCalendarYearActivity(
  completedAtList: (string | null | undefined)[],
  year: number,
  activeToday = false,
): number[] {
  const startMs = new Date(year, 0, 1).getTime();
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = isLeap ? 366 : 365;
  const buckets = new Array<number>(days).fill(0);
  const now = new Date();
  const isCurrentYear = now.getFullYear() === year;
  const todayIdx = isCurrentYear
    ? Math.floor(
        (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - startMs) / 86_400_000,
      )
    : days - 1;
  for (const iso of completedAtList) {
    if (!iso) continue;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) continue;
    const c = new Date(t);
    if (c.getFullYear() !== year) continue;
    const idx = Math.floor(
      (new Date(c.getFullYear(), c.getMonth(), c.getDate()).getTime() - startMs) / 86_400_000,
    );
    if (idx < 0 || idx >= days) continue;
    buckets[idx] += 1;
  }
  if (activeToday && isCurrentYear && todayIdx >= 0 && todayIdx < days && buckets[todayIdx] < 1) {
    buckets[todayIdx] = 1;
  }
  return buckets.map((count, i) => {
    if (isCurrentYear && i > todayIdx) return -1; // future day → empty cell
    return count <= 0 ? 0 : count >= 4 ? 4 : count;
  });
}

export function XpHero({
  displayName,
  truncatedWallet,
  level,
  levelName,
  xpInLevel,
  xpRange,
  currentStreak,
}: {
  displayName: string;
  truncatedWallet: string;
  level: number;
  levelName: string;
  xpInLevel: number;
  xpRange: number;
  currentStreak: number;
}) {
  const pct = Math.min(100, Math.max(0, (xpInLevel / Math.max(1, xpRange)) * 100));
  return (
    <CozyCard data-testid="v2-xp-hero" className="mb-5" style={{ padding: 18 }}>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="flex items-center justify-center rounded-xl shrink-0"
            style={{ width: 44, height: 44, backgroundColor: 'rgba(255,213,128,0.10)', border: `1px solid ${AMBER}40` }}
          >
            <Sparkles size={20} color={AMBER} strokeWidth={2.4} />
          </div>
          <div className="min-w-0">
            <p className="text-xl font-bold font-pixel leading-tight truncate" style={{ color: AMBER, textShadow: SHADOW }}>
              {displayName}
            </p>
            <p className="font-pixel-mono text-[11px] uppercase tracking-[1.5px] truncate" style={{ color: T.textMutedStrong }}>
              {truncatedWallet}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{ backgroundColor: 'rgba(255,213,128,0.10)', border: `1px solid ${AMBER}40` }}
          >
            <Flame size={14} color={AMBER} strokeWidth={2.4} style={{ filter: `drop-shadow(0 0 4px ${AMBER}80)` }} />
            <span className="font-pixel-mono text-[12px] font-bold" style={{ color: AMBER, textShadow: SHADOW }}>
              {currentStreak}d
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Sparkles size={16} color="#2AE8D4" strokeWidth={2.4} />
            <span className="font-pixel-mono text-[11px] font-bold uppercase tracking-[1.5px]" style={{ color: '#2AE8D4', textShadow: SHADOW }}>
              Lv.{level} {levelName}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
          <div
            data-testid="v2-xp-bar"
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${pct}%`, background: 'linear-gradient(90deg, rgba(42,232,212,0.5) 0%, #2AE8D4 100%)', boxShadow: '0 0 8px rgba(42,232,212,0.6)' }}
          />
        </div>
        <span className="font-pixel-mono text-[10px]" style={{ color: T.textMutedStrong }}>
          {xpInLevel}/{xpRange} XP
        </span>
      </div>
    </CozyCard>
  );
}

export function JourneyStats({
  lessonsCompleted,
  longestStreak,
  coursesEnrolled,
  memberSince = '—',
}: {
  lessonsCompleted: number;
  longestStreak: number;
  coursesEnrolled: number;
  memberSince?: string;
}) {
  const stats: { label: string; value: string | number }[] = [
    { label: 'Lessons Completed', value: lessonsCompleted },
    { label: 'Longest Streak', value: `${longestStreak}d` },
    { label: 'Courses Enrolled', value: coursesEnrolled },
    { label: 'Member Since', value: memberSince },
  ];
  return (
    <div data-testid="v2-journey" className="mb-5">
      <CozySectionLabel>Journey</CozySectionLabel>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map((s) => (
          <CozyCard key={s.label} style={{ padding: 14 }}>
            <p className="font-pixel-mono text-[9px] uppercase tracking-[1.5px] mb-1.5" style={{ color: T.textMutedStrong }}>
              {s.label}
            </p>
            <p className="font-pixel-mono text-[16px] font-bold leading-tight" style={{ color: AMBER, textShadow: SHADOW }}>
              {s.value}
            </p>
          </CozyCard>
        ))}
      </div>
    </div>
  );
}

export function ActivityHeatmap({
  completedAtList,
  activeToday,
  longestStreak,
  availableYears,
}: {
  completedAtList: (string | null | undefined)[];
  activeToday: boolean;
  longestStreak: number;
  availableYears: number[];
}) {
  const currentYear = new Date().getFullYear();
  const years = availableYears.length > 0 ? availableYears : [currentYear];
  const [selected, setSelected] = useState(years[0]);
  const year = years.includes(selected) ? selected : years[0];

  const yearActivity = useMemo(
    () => buildCalendarYearActivity(completedAtList, year, activeToday),
    [completedAtList, year, activeToday],
  );

  // Real cells are 0-4; -1 is a future/empty day. Stats ignore future cells.
  const totalActive = yearActivity.filter((v) => v > 0).length;
  const longestRun = (() => {
    let best = 0;
    let cur = 0;
    for (const v of yearActivity) {
      if (v > 0) {
        cur += 1;
        if (cur > best) best = cur;
      } else if (v === 0) {
        cur = 0;
      }
      // v < 0 (future) neither extends nor breaks — it's the trailing tail.
    }
    return best;
  })();

  // Calendar-year grid: column 0 is the week containing Jan 1. Days before Jan 1
  // in that first column are padding (null); days after today (current year) are
  // future (-1) → rendered as empty cells, GitHub-style.
  const jan1 = new Date(year, 0, 1);
  const startTime = jan1.getTime();
  const dayMs = 86_400_000;
  const firstWeekday = (jan1.getDay() + 6) % 7; // Mon=0 offset of Jan 1
  const totalDays = yearActivity.length;
  const cols = Math.ceil((firstWeekday + totalDays) / 7);
  const grid: (number | null)[][] = Array.from({ length: 7 }, () => Array(cols).fill(null));
  for (let i = 0; i < totalDays; i += 1) {
    const dayOffset = firstWeekday + i;
    grid[dayOffset % 7][Math.floor(dayOffset / 7)] = yearActivity[i];
  }
  // Today's linear day-index within the selected year (−1 when not this year).
  const now = new Date();
  const todayIdx =
    now.getFullYear() === year
      ? Math.floor(
          (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - startTime) / dayMs,
        )
      : -1;
  // Month of each column's first real day → label Jan at column 0 + on each change.
  const columnMonth = Array.from({ length: cols }, (_, c) => {
    const dayIdx = Math.min(totalDays - 1, Math.max(0, c * 7 - firstWeekday));
    return new Date(startTime + dayIdx * dayMs).getMonth();
  });

  return (
    <CozyCard data-testid="v2-heatmap" className="mb-5" style={{ padding: 18 }}>
      <div className="mb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="font-pixel-mono text-[10px] font-bold uppercase tracking-[2px]" style={{ color: AMBER, textShadow: SHADOW }}>
            Activity
          </p>
          <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Select year">
            {years.map((y) => {
              const sel = y === year;
              return (
                <button
                  key={y}
                  type="button"
                  onClick={() => setSelected(y)}
                  aria-pressed={sel}
                  className="font-pixel-mono text-[10px] uppercase tracking-[1px] px-2.5 py-1 rounded min-h-[28px]"
                  style={{
                    color: sel ? '#1A1000' : COZY_TEXT,
                    backgroundColor: sel ? AMBER : 'rgba(255,213,128,0.08)',
                    border: `1px solid ${sel ? AMBER : 'rgba(255,213,128,0.30)'}`,
                    boxShadow: sel ? `0 0 8px ${AMBER}66` : undefined,
                  }}
                >
                  {y}
                </button>
              );
            })}
          </div>
        </div>
        <p className="font-pixel-mono text-[10px] mt-1.5" style={{ color: T.textMutedStrong }}>
          {totalActive} active days · {longestRun}d best run · {longestStreak}d longest streak
        </p>
      </div>
      <div className="overflow-x-auto pb-1">
        <div className="inline-block" style={{ minWidth: cols * 13 + 32 }}>
          <div className="flex items-end mb-1 ml-8" style={{ height: 12 }}>
            {Array.from({ length: cols }).map((_, c) => {
              const showLabel = c === 0 || columnMonth[c] !== columnMonth[c - 1];
              if (!showLabel) return <div key={c} style={{ width: 12, marginRight: 2 }} />;
              return (
                <div key={c} className="font-pixel-mono text-[9px] uppercase" style={{ width: 12, marginRight: 2, color: T.textMutedStrong, whiteSpace: 'nowrap' }}>
                  {MONTHS[columnMonth[c]]}
                </div>
              );
            })}
          </div>
          <div className="flex">
            <div className="flex flex-col mr-2" style={{ width: 24, gap: 2 }}>
              {Array.from({ length: 7 }).map((_, r) => {
                const label = r === 0 ? WEEKDAYS[0] : r === 2 ? WEEKDAYS[1] : r === 4 ? WEEKDAYS[2] : '';
                return (
                  <div key={r} className="font-pixel-mono text-[9px] uppercase" style={{ height: 12, lineHeight: '12px', color: T.textMutedStrong }}>
                    {label}
                  </div>
                );
              })}
            </div>
            <div className="flex" style={{ gap: 2 }}>
              {grid[0].map((_, c) => (
                <div key={c} className="flex flex-col" style={{ gap: 2 }}>
                  {grid.map((row, r) => {
                    const v = row[c];
                    const empty = v === null || v < 0; // padding or future day
                    const i = c * 7 + r - firstWeekday;
                    const isToday = todayIdx >= 0 && i === todayIdx;
                    return (
                      <div
                        key={`${r}-${c}`}
                        title={empty ? '' : `Level ${v}`}
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: 2,
                          backgroundColor: empty ? 'transparent' : HEATMAP_LEVEL_BG[v as number],
                          border: isToday ? `1px solid ${AMBER}` : !empty ? '1px solid rgba(0,0,0,0.20)' : '1px solid transparent',
                          boxShadow: isToday ? `0 0 6px ${AMBER}99` : !empty && (v as number) >= 3 ? `0 0 4px rgba(255,213,128,${0.3 + (v as number) * 0.05})` : undefined,
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-1.5 mt-3">
        <span className="font-pixel-mono text-[9px] uppercase tracking-[1px]" style={{ color: T.textMutedStrong }}>
          Less
        </span>
        {HEATMAP_LEVEL_BG.map((bg, i) => (
          <div key={i} style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: bg, border: '1px solid rgba(0,0,0,0.20)' }} />
        ))}
        <span className="font-pixel-mono text-[9px] uppercase tracking-[1px]" style={{ color: T.textMutedStrong }}>
          More
        </span>
      </div>
    </CozyCard>
  );
}
