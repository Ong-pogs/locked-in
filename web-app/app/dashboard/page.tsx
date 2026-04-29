'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCourseStore, useUserStore } from '@/stores';
import { getUserXp, getYieldHistory } from '@/services/api/progress/progressApi';
import { fetchWithAuth } from '@/services/api/httpClient';
import {
  ScreenBackground,
  BackButton,
  ParchmentCard,
  StatBox,
  SectionLabel,
  T,
} from '@/components/theme';

const LEVEL_NAMES = ['Novice', 'Apprentice', 'Scholar', 'Adept', 'Master', 'Sage', 'Legend'];
const XP_THRESHOLDS = [0, 500, 1500, 3500, 7000, 12000, 20000];

export default function DashboardPage() {
  const router = useRouter();
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const courseStates = useCourseStore((s) => s.courseStates);
  const courses = useCourseStore((s) => s.courses);
  const lessons = useCourseStore((s) => s.lessons);
  const lessonProgress = useCourseStore((s) => s.lessonProgress);
  const enrolledCourseIds = useCourseStore((s) => s.enrolledCourseIds);
  const authToken = useUserStore((s) => s.authToken);

  const [xp, setXp] = useState({ xpTotal: 0, xpLevel: 1 });
  const [yieldData, setYieldData] = useState({ totalYield: 0, redirected: 0, fees: 0 });

  useEffect(() => {
    if (authToken) {
      getUserXp(authToken).then((data) => setXp({ xpTotal: data.xpTotal, xpLevel: data.xpLevel })).catch(() => {});
    }
  }, [authToken]);

  useEffect(() => {
    if (!activeCourseId) return;
    fetchWithAuth((token) => getYieldHistory(activeCourseId, token))
      .then((data) => {
        if (data) setYieldData({
          totalYield: parseFloat(data.totalGrossYieldUi || '0'),
          redirected: parseFloat(data.totalRedirectedUi || '0'),
          fees: parseFloat(data.totalPlatformFeeUi || '0'),
        });
      })
      .catch(() => {});
  }, [activeCourseId]);

  const activeState = activeCourseId ? courseStates[activeCourseId] ?? null : null;
  const activeCourse = activeCourseId ? courses.find((c) => c.id === activeCourseId) : null;

  const fuelBalance = activeState?.fuelCounter ?? 0;
  const fuelCap = activeState?.fuelCap ?? 7;
  const fuelFragments = activeState?.fuelFragmentsToday ?? 0;
  const ichorBalance = activeState?.ichorBalance ?? 0;

  // Total lessons completed across all courses
  const totalCompleted = Object.values(lessonProgress).filter((p) => p.completed).length;
  const totalLessons = Object.values(lessons).reduce((sum, arr) => sum + arr.length, 0);

  // Enrolled course count
  const enrolledCount = enrolledCourseIds.filter((id) => Boolean(courseStates[id]?.lockAccountAddress)).length;

  const levelName = LEVEL_NAMES[xp.xpLevel - 1] ?? `Level ${xp.xpLevel}`;
  const currentThreshold = XP_THRESHOLDS[xp.xpLevel - 1] ?? 0;
  const nextThreshold = XP_THRESHOLDS[xp.xpLevel] ?? currentThreshold + 1000;
  const xpProgress = Math.min(1, Math.max(0, (xp.xpTotal - currentThreshold) / (nextThreshold - currentThreshold)));

  // Lock progress
  const [lockProgress, setLockProgress] = useState<{ totalDays: number; elapsed: number; endDate: Date } | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!activeState?.lockStartDate) { setLockProgress(null); return; }
    const start = new Date(activeState.lockStartDate).getTime();
    const totalDays = (activeState.lockDuration ?? 30) + (activeState.extensionDays ?? 0);
    const endDate = new Date(start + totalDays * 86400000);
    const elapsed = Math.max(0, Math.floor((Date.now() - start) / 86400000));
    setLockProgress({ totalDays, elapsed: Math.min(elapsed, totalDays), endDate });
  }, [activeState?.lockStartDate, activeState?.lockDuration, activeState?.extensionDays]);

  const netEarned = yieldData.totalYield - yieldData.redirected - yieldData.fees;

  return (
    <ScreenBackground>
      <BackButton onClick={() => router.back()} />

      {/* Hero — XP + Level */}
      <div className="text-center pt-2 pb-5">
        <p className="font-mono text-[10px] uppercase tracking-[2px] mb-1" style={{ color: T.textMuted }}>
          Your Progress
        </p>
        <p className="text-[28px] font-bold" style={{ color: T.amber, fontFamily: 'Georgia, serif' }}>
          Lv.{xp.xpLevel} {levelName}
        </p>
        <div className="max-w-xs mx-auto mt-3">
          <div className="flex justify-between mb-1">
            <span className="text-[10px] font-mono" style={{ color: T.textSecondary }}>{xp.xpTotal} XP</span>
            <span className="text-[10px] font-mono" style={{ color: T.textMuted }}>{nextThreshold} XP</span>
          </div>
          <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${Math.min(100, Math.max(0, xpProgress * 100))}%`, backgroundColor: T.amber }}
            />
          </div>
        </div>
      </div>

      {/* Stats grid — 2-col on mobile, 6-col on desktop */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5">
        <StatBox label="Locked" value={`${activeState?.lockAmount ?? 0}`} suffix="USDC" color={T.amber} />
        <StatBox label="Earned" value={yieldData.totalYield.toFixed(2)} suffix="USDC" color={T.green} />
        <StatBox label="Fuel" value={`${fuelBalance}/${fuelCap}`} color={T.rust} />
        <StatBox label="Ichor" value={Math.floor(ichorBalance)} color={T.green} />
        <StatBox label="Lessons" value={`${totalCompleted}/${totalLessons}`} color={T.violet} />
        <StatBox label="Courses" value={enrolledCount} color={T.teal} />
      </div>

      {/* Cards — single column on mobile, 2-col on desktop */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">

      {/* Earnings Overview */}
      <ParchmentCard className="p-4">
        <SectionLabel>Earnings Overview</SectionLabel>
        <div className="flex flex-col gap-2 mt-1">
          <div className="flex justify-between items-center">
            <span className="text-[12px]" style={{ color: T.textSecondary }}>Total Yield</span>
            <span className="text-[13px] font-mono font-bold" style={{ color: T.green }}>
              {yieldData.totalYield.toFixed(4)} USDC
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[12px]" style={{ color: T.textSecondary }}>Redirected</span>
            <span className="text-[13px] font-mono" style={{ color: T.rust }}>
              -{yieldData.redirected.toFixed(4)}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[12px]" style={{ color: T.textSecondary }}>Community Share</span>
            <span className="text-[13px] font-mono" style={{ color: T.textMuted }}>
              -{yieldData.fees.toFixed(4)}
            </span>
          </div>
          <div className="w-full h-px my-1" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
          <div className="flex justify-between items-center">
            <span className="text-[12px] font-bold" style={{ color: T.textPrimary }}>Net Earned</span>
            <span className="text-[13px] font-mono font-bold" style={{ color: T.amber }}>
              {netEarned.toFixed(4)} USDC
            </span>
          </div>
        </div>
      </ParchmentCard>

      {/* Fuel progress today */}
      <ParchmentCard className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-[10px] uppercase tracking-[1px]" style={{ color: T.textSecondary }}>
            Today&apos;s Fuel
          </span>
          <span className="text-[11px] font-mono font-bold" style={{ color: fuelFragments >= 1 ? T.green : T.amber }}>
            {fuelFragments.toFixed(2)} / 1.00
          </span>
        </div>
        <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(100, fuelFragments * 100)}%`, backgroundColor: fuelFragments >= 1 ? T.green : T.amber }}
          />
        </div>
      </ParchmentCard>

      {/* Lock Status */}
      <ParchmentCard className="p-4">
        <SectionLabel>Lock Status</SectionLabel>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-[28px]">{'\u{1F512}'}</span>
          <div className="flex-1">
            <p className="text-[15px] font-bold" style={{ color: T.amber, fontFamily: 'Georgia, serif' }}>
              {activeState?.lockAmount ?? 0} USDC
            </p>
            {lockProgress ? (
              <>
                <p className="text-[11px] mt-0.5" style={{ color: T.textSecondary }}>
                  Unlocks {lockProgress.endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
                <div className="w-full h-1.5 rounded-full overflow-hidden mt-2" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (lockProgress.elapsed / lockProgress.totalDays) * 100)}%`,
                      backgroundColor: T.amber,
                    }}
                  />
                </div>
                <p className="text-[10px] font-mono mt-1" style={{ color: T.textMuted }}>
                  {lockProgress.elapsed}/{lockProgress.totalDays} days elapsed
                </p>
              </>
            ) : (
              <p className="text-[11px] mt-0.5" style={{ color: T.textMuted }}>
                No active lock
              </p>
            )}
          </div>
        </div>
      </ParchmentCard>

      {/* Active course */}
      {activeCourse && (
        <ParchmentCard className="p-4">
          <SectionLabel>Active Course</SectionLabel>
          <p className="text-[15px] font-bold mt-1" style={{ color: T.textPrimary, fontFamily: 'Georgia, serif' }}>
            {activeCourse.title}
          </p>
          <p className="text-[11px] mt-1" style={{ color: T.textSecondary }}>
            {activeCourse.completedLessons}/{(lessons[activeCourse.id] ?? []).length || activeCourse.totalLessons} lessons completed
          </p>
          <button
            onClick={() => router.push('/village')}
            className="w-full mt-3 py-2.5 rounded-lg text-center font-bold text-sm uppercase tracking-[1px]"
            style={{
              border: `1px solid ${T.amber}`,
              background: 'rgba(212,160,74,0.12)',
              color: T.amber,
              fontFamily: 'Georgia, serif',
            }}
          >
            {'\u25C6'} Continue Lesson {'\u25C6'}
          </button>
        </ParchmentCard>
      )}
      </div>
    </ScreenBackground>
  );
}
