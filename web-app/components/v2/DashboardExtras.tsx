'use client';

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

/** 365 daily buckets (index 0 = oldest, last = today) → level 0-4 from completion counts. */
export function buildYearActivity(completedAtList: (string | null | undefined)[]): number[] {
  const days = 365;
  const buckets = new Array<number>(days).fill(0);
  const today = new Date();
  const midnightToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  for (const iso of completedAtList) {
    if (!iso) continue;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) continue;
    const c = new Date(t);
    const cMid = new Date(c.getFullYear(), c.getMonth(), c.getDate()).getTime();
    const dayDiff = Math.floor((midnightToday - cMid) / 86_400_000);
    if (dayDiff < 0 || dayDiff >= days) continue;
    buckets[days - 1 - dayDiff] += 1;
  }
  return buckets.map((count) => (count <= 0 ? 0 : count >= 4 ? 4 : count));
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

export function ActivityHeatmap({ yearActivity, longestStreak }: { yearActivity: number[]; longestStreak: number }) {
  const totalActive = yearActivity.filter((v) => v > 0).length;
  const longestRun = (() => {
    let best = 0;
    let cur = 0;
    for (const v of yearActivity) {
      if (v > 0) {
        cur += 1;
        if (cur > best) best = cur;
      } else cur = 0;
    }
    return best;
  })();
  const today = new Date();
  const todayWeekday = (today.getDay() + 6) % 7;
  const totalDays = yearActivity.length;
  const firstWeekday = (todayWeekday - (totalDays - 1) + 7000) % 7;
  const cols = Math.ceil((firstWeekday + totalDays) / 7);
  const grid: (number | null)[][] = Array.from({ length: 7 }, () => Array(cols).fill(null));
  for (let i = 0; i < totalDays; i += 1) {
    const dayOffset = firstWeekday + i;
    grid[dayOffset % 7][Math.floor(dayOffset / 7)] = yearActivity[i];
  }
  const monthLabelCols = MONTHS.map((_, i) => Math.round((i * cols) / 12));

  return (
    <CozyCard data-testid="v2-heatmap" className="mb-5" style={{ padding: 18 }}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className="font-pixel-mono text-[10px] font-bold uppercase tracking-[2px]" style={{ color: AMBER, textShadow: SHADOW }}>
          Past Year of Activity
        </p>
        <p className="font-pixel-mono text-[10px]" style={{ color: T.textMutedStrong }}>
          {totalActive} active days · {longestRun}d best run · {longestStreak}d longest streak
        </p>
      </div>
      <div className="overflow-x-auto pb-1">
        <div className="inline-block" style={{ minWidth: cols * 13 + 32 }}>
          <div className="flex items-end mb-1 ml-8" style={{ height: 12 }}>
            {Array.from({ length: cols }).map((_, c) => {
              const monthIdx = monthLabelCols.indexOf(c);
              if (monthIdx === -1) return <div key={c} style={{ width: 12, marginRight: 2 }} />;
              return (
                <div key={c} className="font-pixel-mono text-[9px] uppercase" style={{ width: 12, marginRight: 2, color: T.textMutedStrong, whiteSpace: 'nowrap' }}>
                  {MONTHS[monthIdx]}
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
                    const isToday = c === cols - 1 && r === todayWeekday && v !== null;
                    return (
                      <div
                        key={`${r}-${c}`}
                        title={v === null ? '' : `Level ${v}`}
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: 2,
                          backgroundColor: v === null ? 'transparent' : HEATMAP_LEVEL_BG[v],
                          border: isToday ? `1px solid ${AMBER}` : v !== null ? '1px solid rgba(0,0,0,0.20)' : '1px solid transparent',
                          boxShadow: isToday ? `0 0 6px ${AMBER}99` : v && v >= 3 ? `0 0 4px rgba(255,213,128,${0.3 + v * 0.05})` : undefined,
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
