'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Flame,
  FlaskConical,
  Droplet,
  Sparkles,
  Shield,
  BookOpen,
  ChevronRight,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { T } from '@/components/theme';
import { CozyCard } from '@/components/cozy';
import { HubButton } from '@/components/HubButton';
import { useCourseStore, useUserStore } from '@/stores';
import { getUserXp } from '@/services/api/progress/progressApi';

/* ──────────────────────────────────────────────────────────────────────
   Constants
   ────────────────────────────────────────────────────────────────────── */

const AMBER = '#FFD580';

const LEVEL_NAMES = ['Novice', 'Apprentice', 'Scholar', 'Adept', 'Master', 'Sage', 'Legend'];
const DEFAULT_XP_THRESHOLDS = [0, 500, 1500, 3500, 7000, 12000, 20000];

const HEATMAP_LEVEL_BG = [
  'rgba(255,255,255,0.06)',
  'rgba(255,213,128,0.20)',
  'rgba(255,213,128,0.40)',
  'rgba(255,213,128,0.65)',
  'rgba(255,213,128,0.95)',
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mon', 'Wed', 'Fri'];

/* ──────────────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────────────── */

function todayString() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diffMs = Date.now() - t;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 7) return `${day}d ago`;
  if (day < 30) return `${Math.floor(day / 7)}w ago`;
  if (day < 365) return `${Math.floor(day / 30)}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}

function deriveIchorTier(totalProduced: number): { tier: number; tierMax: number } {
  if (totalProduced <= 9999) return { tier: 1, tierMax: 10000 };
  if (totalProduced <= 49999) return { tier: 2, tierMax: 50000 };
  if (totalProduced <= 99999) return { tier: 3, tierMax: 100000 };
  return { tier: 4, tierMax: 999999 };
}

/* ──────────────────────────────────────────────────────────────────────
   Year-activity heatmap derivation (365 days from lesson completions)
   ────────────────────────────────────────────────────────────────────── */

function buildYearActivity(completedAtList: (string | null | undefined)[]): number[] {
  const days = 365;
  const buckets = new Array<number>(days).fill(0);
  const today = new Date();
  // normalize to midnight
  const midnightToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

  for (const iso of completedAtList) {
    if (!iso) continue;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) continue;
    const completed = new Date(t);
    const completedMidnight = new Date(
      completed.getFullYear(),
      completed.getMonth(),
      completed.getDate(),
    ).getTime();
    const dayDiff = Math.floor((midnightToday - completedMidnight) / 86400000);
    if (dayDiff < 0 || dayDiff >= days) continue;
    // index 0 = oldest (365 days ago), index days-1 = today
    const idx = days - 1 - dayDiff;
    buckets[idx] += 1;
  }
  // Map count → level (0-4)
  return buckets.map((count) => {
    if (count <= 0) return 0;
    if (count === 1) return 1;
    if (count === 2) return 2;
    if (count === 3) return 3;
    return 4;
  });
}

/* ──────────────────────────────────────────────────────────────────────
   Tile / pip rendering
   ────────────────────────────────────────────────────────────────────── */

type StatTile = {
  key: string;
  label: string;
  value: number;
  cap: number;
  display: string;
  color: string;
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  hint: string;
};

const PIP_COUNT = 10;

function PipTile({ s }: { s: StatTile }) {
  const filled = Math.round(Math.min(1, Math.max(0, s.value / Math.max(1, s.cap))) * PIP_COUNT);
  return (
    <CozyCard style={{ padding: 16 }}>
      <div className="flex items-center justify-between mb-2">
        <span
          className="font-pixel-mono text-[10px] uppercase tracking-[1.5px]"
          style={{ color: T.textMuted }}
        >
          {s.label}
        </span>
        <s.Icon size={16} color={s.color} strokeWidth={2.2} />
      </div>
      <p
        className="text-2xl font-bold font-pixel-mono leading-tight mb-2"
        style={{ color: s.color, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
      >
        {s.display}
      </p>
      <div className="flex items-center gap-1">
        {Array.from({ length: PIP_COUNT }).map((_, i) => (
          <div
            key={i}
            className="flex-1 h-2 rounded-sm"
            style={{
              backgroundColor: i < filled ? s.color : 'rgba(255,255,255,0.10)',
              boxShadow: i < filled ? `0 0 4px ${s.color}80` : undefined,
            }}
          />
        ))}
      </div>
      <p className="text-[10px] mt-1.5 font-pixel-mono" style={{ color: T.textMuted }}>
        {s.hint}
      </p>
    </CozyCard>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Hero — Bold variant
   ────────────────────────────────────────────────────────────────────── */

function HeroBold(props: {
  displayName: string;
  level: number;
  levelName: string;
  xpInLevel: number;
  xpRange: number;
  currentStreak: number;
}) {
  const { displayName, level, levelName, xpInLevel, xpRange, currentStreak } = props;
  const pct = Math.min(100, Math.max(0, (xpInLevel / Math.max(1, xpRange)) * 100));
  return (
    <CozyCard className="mb-5" style={{ padding: 18 }}>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
        <div className="min-w-0">
          <p className="font-pixel-mono text-[10px] uppercase tracking-[1.5px]" style={{ color: T.textMuted }}>
            {todayString()}
          </p>
          <p
            className="text-xl font-bold font-pixel"
            style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
          >
            Welcome back, {displayName}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Streak chip */}
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{
              backgroundColor: 'rgba(255,213,128,0.10)',
              border: `1px solid ${AMBER}40`,
            }}
          >
            <Flame
              size={14}
              color={AMBER}
              strokeWidth={2.4}
              style={{ filter: `drop-shadow(0 0 4px ${AMBER}80)` }}
            />
            <span
              className="font-pixel-mono text-[12px] font-bold"
              style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
            >
              {currentStreak}d
            </span>
          </div>
          {/* Level chip */}
          <div className="flex items-center gap-2">
            <Sparkles size={16} color="#2AE8D4" strokeWidth={2.4} />
            <span
              className="font-pixel-mono text-[11px] font-bold uppercase tracking-[1.5px]"
              style={{ color: '#2AE8D4', textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
            >
              Lv.{level} {levelName}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div
          className="flex-1 h-2 rounded-full overflow-hidden"
          style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
        >
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${pct}%`,
              background: 'linear-gradient(90deg, rgba(42,232,212,0.5) 0%, #2AE8D4 100%)',
              boxShadow: '0 0 8px rgba(42,232,212,0.6)',
            }}
          />
        </div>
        <span className="font-pixel-mono text-[10px]" style={{ color: T.textMuted }}>
          {xpInLevel}/{xpRange} XP
        </span>
      </div>
    </CozyCard>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Pips row — Bold variant has just Fuel + Ichor
   ────────────────────────────────────────────────────────────────────── */

function PipsRow({ tiles }: { tiles: StatTile[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 mb-5">
      {tiles.map((t) => (
        <PipTile key={t.key} s={t} />
      ))}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Heatmap
   ────────────────────────────────────────────────────────────────────── */

function HeatmapSection({
  yearActivity,
  longestStreak,
}: {
  yearActivity: number[];
  longestStreak: number;
}) {
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
  for (let i = 0; i < totalDays; i++) {
    const dayOffset = firstWeekday + i;
    const row = dayOffset % 7;
    const col = Math.floor(dayOffset / 7);
    grid[row][col] = yearActivity[i];
  }
  const monthLabelCols = MONTHS.map((_, i) => Math.round((i * cols) / 12));

  return (
    <CozyCard className="mb-5" style={{ padding: 18 }}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p
          className="font-pixel-mono text-[10px] font-bold uppercase tracking-[2px]"
          style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
        >
          Past Year of Activity
        </p>
        <p className="font-pixel-mono text-[10px]" style={{ color: T.textMuted }}>
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
                <div
                  key={c}
                  className="font-pixel-mono text-[9px] uppercase"
                  style={{ width: 12, marginRight: 2, color: T.textMuted, whiteSpace: 'nowrap' }}
                >
                  {MONTHS[monthIdx]}
                </div>
              );
            })}
          </div>
          <div className="flex">
            <div className="flex flex-col mr-2" style={{ width: 24, gap: 2 }}>
              {Array.from({ length: 7 }).map((_, r) => {
                const label =
                  r === 0 ? WEEKDAYS[0] : r === 2 ? WEEKDAYS[1] : r === 4 ? WEEKDAYS[2] : '';
                return (
                  <div
                    key={r}
                    className="font-pixel-mono text-[9px] uppercase"
                    style={{ height: 12, lineHeight: '12px', color: T.textMuted }}
                  >
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
                          border: isToday
                            ? `1px solid ${AMBER}`
                            : v !== null
                              ? '1px solid rgba(0,0,0,0.20)'
                              : '1px solid transparent',
                          boxShadow:
                            isToday
                              ? `0 0 6px ${AMBER}99`
                              : v && v >= 3
                                ? `0 0 4px rgba(255,213,128,${0.30 + v * 0.05})`
                                : undefined,
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
        <span
          className="font-pixel-mono text-[9px] uppercase tracking-[1px]"
          style={{ color: T.textMuted }}
        >
          Less
        </span>
        {HEATMAP_LEVEL_BG.map((bg, i) => (
          <div
            key={i}
            style={{
              width: 12,
              height: 12,
              borderRadius: 2,
              backgroundColor: bg,
              border: '1px solid rgba(0,0,0,0.20)',
            }}
          />
        ))}
        <span
          className="font-pixel-mono text-[9px] uppercase tracking-[1px]"
          style={{ color: T.textMuted }}
        >
          More
        </span>
      </div>
    </CozyCard>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Flame management
   ────────────────────────────────────────────────────────────────────── */

function FlameManagement(props: {
  flameState: 'lit' | 'extinguished';
  saversTotal: number;
  saversRemaining: number;
  yieldRedirectPct: number;
  recoveryMode: boolean;
}) {
  const { flameState, saversTotal, saversRemaining, yieldRedirectPct, recoveryMode } = props;
  const saversUsed = saversTotal - saversRemaining;
  const flameLit = flameState === 'lit';

  let riskText: string;
  let riskColor: string;
  if (recoveryMode) {
    riskText = `Recovery — ${yieldRedirectPct}% yield redirected`;
    riskColor = T.crimson;
  } else if (saversRemaining === 0) {
    riskText = 'No savers — break this streak and recovery begins';
    riskColor = T.crimson;
  } else if (saversRemaining === 1) {
    riskText = 'Last saver remaining — handle with care';
    riskColor = '#E8845A';
  } else {
    riskText = `${saversRemaining} savers banked · flame is healthy`;
    riskColor = '#3EE68A';
  }

  return (
    <CozyCard className="mb-5" style={{ padding: 18 }}>
      <p
        className="font-pixel-mono text-[10px] font-bold uppercase tracking-[2px] mb-3"
        style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
      >
        Flame Management
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">
        <div>
          <p
            className="font-pixel-mono text-[9px] uppercase tracking-[1.5px] mb-2"
            style={{ color: T.textMuted }}
          >
            Savers
          </p>
          <div className="flex items-center gap-2">
            {Array.from({ length: saversTotal }).map((_, i) => {
              const remaining = i < saversRemaining;
              return (
                <div
                  key={i}
                  className="flex items-center justify-center rounded-md"
                  style={{
                    width: 36,
                    height: 36,
                    backgroundColor: remaining ? 'rgba(62,230,138,0.12)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${remaining ? 'rgba(62,230,138,0.50)' : 'rgba(255,255,255,0.10)'}`,
                    boxShadow: remaining ? '0 0 8px rgba(62,230,138,0.30)' : undefined,
                    opacity: remaining ? 1 : 0.45,
                  }}
                >
                  <Shield size={18} color={remaining ? '#3EE68A' : T.textMuted} strokeWidth={2.4} />
                </div>
              );
            })}
          </div>
          <p className="font-pixel-mono text-[10px] mt-2" style={{ color: T.textMuted }}>
            {saversRemaining}/{saversTotal} banked · {saversUsed} used
          </p>
        </div>

        <div>
          <p
            className="font-pixel-mono text-[9px] uppercase tracking-[1.5px] mb-2"
            style={{ color: T.textMuted }}
          >
            Risk Meter
          </p>
          <p
            className="font-pixel text-[14px] font-bold leading-tight"
            style={{ color: riskColor, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
          >
            {riskText}
          </p>
          <p className="font-pixel-mono text-[10px] mt-2" style={{ color: T.textMuted }}>
            Yield redirect: {yieldRedirectPct}%
          </p>
        </div>

        <div>
          <p
            className="font-pixel-mono text-[9px] uppercase tracking-[1.5px] mb-2"
            style={{ color: T.textMuted }}
          >
            Flame
          </p>
          <div className="flex items-center gap-2">
            <Flame
              size={28}
              color={flameLit ? AMBER : T.textMuted}
              strokeWidth={2.4}
              style={{ filter: flameLit ? `drop-shadow(0 0 6px ${AMBER}80)` : undefined }}
            />
            <p
              className="font-pixel text-[14px] font-bold capitalize"
              style={{ color: flameLit ? AMBER : T.textMuted, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
            >
              {flameState}
            </p>
          </div>
          <p className="font-pixel-mono text-[10px] mt-2" style={{ color: T.textMuted }}>
            {flameLit ? 'Yield is active' : 'Yield is paused'}
          </p>
        </div>
      </div>
    </CozyCard>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Active Courses + Recent Activity
   ────────────────────────────────────────────────────────────────────── */

type ActiveCourseRow = {
  id: string;
  title: string;
  completedLessons: number;
  totalLessons: number;
  nextLessonTitle: string;
};

type RecentActivityRow = {
  id: string;
  label: string;
  when: string;
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  color: string;
};

function CoursesAndActivity({
  activeCourses,
  recentActivity,
  onCourseClick,
}: {
  activeCourses: ActiveCourseRow[];
  recentActivity: RecentActivityRow[];
  onCourseClick: (courseId: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <CozyCard>
        <p
          className="font-pixel-mono text-[10px] font-bold uppercase tracking-[2px] mb-3"
          style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
        >
          Active Courses
        </p>
        {activeCourses.length === 0 ? (
          <p className="font-pixel-mono text-[11px]" style={{ color: T.textMuted }}>
            No active courses yet — head to the bookshelf to enroll.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {activeCourses.map((c) => {
              const pct = c.totalLessons > 0 ? (c.completedLessons / c.totalLessons) * 100 : 0;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onCourseClick(c.id)}
                  className="text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 rounded"
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p
                      className="text-[13px] font-bold font-pixel truncate"
                      style={{ color: T.textPrimary }}
                    >
                      {c.title}
                    </p>
                    <span
                      className="font-pixel-mono text-[10px] flex items-center gap-0.5 shrink-0"
                      style={{ color: AMBER }}
                    >
                      Continue <ChevronRight size={12} color={AMBER} strokeWidth={2.5} />
                    </span>
                  </div>
                  <div
                    className="w-full h-1.5 rounded-full overflow-hidden"
                    style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${pct}%`,
                        background: `linear-gradient(90deg, ${AMBER}66 0%, ${AMBER} 100%)`,
                        boxShadow: `0 0 6px ${AMBER}55`,
                      }}
                    />
                  </div>
                  <p className="text-[10px] mt-1 font-pixel-mono" style={{ color: T.textMuted }}>
                    {c.completedLessons}/{c.totalLessons} lessons · next: {c.nextLessonTitle}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </CozyCard>

      <CozyCard>
        <p
          className="font-pixel-mono text-[10px] font-bold uppercase tracking-[2px] mb-3"
          style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
        >
          Recent Activity
        </p>
        {recentActivity.length === 0 ? (
          <p className="font-pixel-mono text-[11px]" style={{ color: T.textMuted }}>
            No activity yet — complete a lesson to see it here.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {recentActivity.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2.5 py-1.5"
                style={{ borderBottom: '1px dashed rgba(255,255,255,0.06)' }}
              >
                <a.Icon size={14} color={a.color} strokeWidth={2.2} />
                <p
                  className="text-[12px] font-pixel flex-1 truncate"
                  style={{ color: T.textSecondary }}
                >
                  {a.label}
                </p>
                <span
                  className="font-pixel-mono text-[9px] uppercase tracking-[1px] shrink-0"
                  style={{ color: T.textMuted }}
                >
                  {a.when}
                </span>
              </div>
            ))}
          </div>
        )}
      </CozyCard>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Page
   ────────────────────────────────────────────────────────────────────── */

export default function DashboardPage() {
  const router = useRouter();

  // ── Stores ──
  const displayName = useUserStore((s) => s.displayName) || 'Adventurer';
  const authToken = useUserStore((s) => s.authToken);

  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const courseStates = useCourseStore((s) => s.courseStates);
  const courses = useCourseStore((s) => s.courses);
  const lessons = useCourseStore((s) => s.lessons);
  const lessonProgress = useCourseStore((s) => s.lessonProgress);
  const enrolledCourseIds = useCourseStore((s) => s.enrolledCourseIds);

  // ── XP from API ──
  const [xpData, setXpData] = useState<{ xpTotal: number; xpLevel: number; thresholds: number[] }>({
    xpTotal: 0,
    xpLevel: 1,
    thresholds: DEFAULT_XP_THRESHOLDS,
  });

  useEffect(() => {
    if (!authToken) return;
    getUserXp(authToken)
      .then((data) => {
        setXpData({
          xpTotal: data.xpTotal ?? 0,
          xpLevel: data.xpLevel ?? 1,
          thresholds:
            data.levelThresholds && data.levelThresholds.length > 0
              ? data.levelThresholds
              : DEFAULT_XP_THRESHOLDS,
        });
      })
      .catch(() => {});
  }, [authToken]);

  // ── Derived values ──
  const activeState = activeCourseId ? courseStates[activeCourseId] ?? null : null;

  const level = Math.max(1, xpData.xpLevel);
  const levelName = LEVEL_NAMES[level - 1] ?? `Level ${level}`;
  const xpFromLevel = xpData.thresholds[level - 1] ?? 0;
  const xpToNext =
    xpData.thresholds[level] ?? xpFromLevel + Math.max(1, xpData.xpTotal - xpFromLevel) * 2;
  const xpInLevel = Math.max(0, xpData.xpTotal - xpFromLevel);
  const xpRange = Math.max(1, xpToNext - xpFromLevel);

  const currentStreak = activeState?.currentStreak ?? 0;
  const longestStreak = Math.max(
    ...Object.values(courseStates).map((s) => s?.longestStreak ?? 0),
    0,
  );
  const flameState: 'lit' | 'extinguished' = currentStreak > 0 ? 'lit' : 'extinguished';

  const saversTotal = 3;
  const saversRemaining = Math.max(0, 3 - (activeState?.saverCount ?? 0));
  const yieldRedirectPct = Math.round((activeState?.currentYieldRedirectBps ?? 0) / 100);
  const recoveryMode = activeState?.saverRecoveryMode ?? false;

  const fuelToday = activeState?.fuelFragmentsToday ?? 0;
  const fuelBalance = activeState?.fuelCounter ?? 0;
  const fuelCap = activeState?.fuelCap ?? 7;

  const ichorBalance = activeState?.ichorBalance ?? 0;
  const totalIchorProduced = activeState?.totalIchorProduced ?? 0;
  const { tier: ichorTier, tierMax: ichorTierMax } = deriveIchorTier(totalIchorProduced);

  // ── Active courses (only those with a real lock account) ──
  const activeCourses: ActiveCourseRow[] = useMemo(() => {
    return enrolledCourseIds
      .filter((id) => Boolean(courseStates[id]?.lockAccountAddress))
      .map((id) => {
        const course = courses.find((c) => c.id === id);
        const courseLessons = lessons[id] ?? [];
        const completedCount = courseLessons.filter(
          (l) => lessonProgress[l.id]?.completed,
        ).length;
        const nextLesson = courseLessons.find((l) => !lessonProgress[l.id]?.completed);
        const nextLessonTitle = nextLesson?.title ?? course?.title ?? 'Continue';
        return {
          id,
          title: course?.title ?? id,
          completedLessons: completedCount,
          totalLessons: courseLessons.length || course?.totalLessons || 0,
          nextLessonTitle,
        };
      });
  }, [enrolledCourseIds, courseStates, courses, lessons, lessonProgress]);

  // ── Recent activity (top 5 most recently completed lessons) ──
  const recentActivity: RecentActivityRow[] = useMemo(() => {
    const completed = Object.values(lessonProgress)
      .filter((p) => p.completed && p.completedAt)
      .sort((a, b) => {
        const aT = a.completedAt ? Date.parse(a.completedAt) : 0;
        const bT = b.completedAt ? Date.parse(b.completedAt) : 0;
        return bT - aT;
      })
      .slice(0, 5);

    return completed.map((p) => {
      // Locate lesson title by scanning lessons across all courses
      let lessonTitle: string | null = null;
      for (const arr of Object.values(lessons)) {
        const found = arr.find((l) => l.id === p.lessonId);
        if (found) {
          lessonTitle = found.title;
          break;
        }
      }
      const label = lessonTitle ? `Completed "${lessonTitle}"` : 'Completed a lesson';
      return {
        id: p.lessonId,
        label,
        when: relativeTime(p.completedAt),
        Icon: BookOpen,
        color: '#3EE68A',
      };
    });
  }, [lessonProgress, lessons]);

  // ── Year activity heatmap (derived from lesson progress) ──
  const yearActivity = useMemo(
    () =>
      buildYearActivity(
        Object.values(lessonProgress)
          .filter((p) => p.completed)
          .map((p) => p.completedAt),
      ),
    [lessonProgress],
  );

  // ── Stat tiles for pips row (Bold variant: Fuel + Ichor) ──
  const fuelTile: StatTile = {
    key: 'fuel',
    label: 'Fuel',
    value: fuelBalance,
    cap: fuelCap,
    display: `${fuelBalance}/${fuelCap}`,
    color: '#E8845A',
    Icon: Droplet,
    hint: `+${fuelToday.toFixed(1)} today`,
  };
  const ichorTile: StatTile = {
    key: 'ichor',
    label: 'Ichor',
    value: ichorBalance,
    cap: ichorTierMax,
    display: Math.floor(ichorBalance).toLocaleString(),
    color: '#3EE68A',
    Icon: FlaskConical,
    hint:
      ichorTier < 4
        ? `${(ichorTierMax - ichorBalance).toLocaleString()} to Tier ${ichorTier + 1}`
        : `Tier ${ichorTier} (max)`,
  };

  // ── Course click handler ──
  const handleCourseClick = (courseId: string) => {
    useCourseStore.getState().setActiveCourse(courseId);
    router.push('/village');
  };

  return (
    <div className="min-h-screen relative" style={{ backgroundColor: T.bg }}>
      <div aria-hidden className="fixed inset-0 z-0 pointer-events-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/cottage/profilebackground.png"
          alt=""
          draggable={false}
          className="w-full h-full object-cover select-none"
          style={{ imageRendering: 'pixelated' }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(14,14,28,0.30) 0%, rgba(14,14,28,0.55) 60%, rgba(14,14,28,0.78) 100%)',
          }}
        />
      </div>

      <HubButton />

      <div className="relative z-10 max-w-[1100px] mx-auto px-[18px] pb-12">
        <div className="pt-20" />

        <h1
          className="text-3xl font-bold tracking-wide font-pixel mb-1"
          style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
        >
          Dashboard
        </h1>
        <p className="text-sm leading-[18px] mb-5" style={{ color: 'rgba(255,255,255,0.6)' }}>
          Today&apos;s pulse — your streak, fuel, courses, and activity
        </p>

        <HeroBold
          displayName={displayName}
          level={level}
          levelName={levelName}
          xpInLevel={xpInLevel}
          xpRange={xpRange}
          currentStreak={currentStreak}
        />

        <PipsRow tiles={[fuelTile, ichorTile]} />

        <HeatmapSection yearActivity={yearActivity} longestStreak={longestStreak} />

        <FlameManagement
          flameState={flameState}
          saversTotal={saversTotal}
          saversRemaining={saversRemaining}
          yieldRedirectPct={yieldRedirectPct}
          recoveryMode={recoveryMode}
        />

        <CoursesAndActivity
          activeCourses={activeCourses}
          recentActivity={recentActivity}
          onCourseClick={handleCourseClick}
        />
      </div>
    </div>
  );
}
