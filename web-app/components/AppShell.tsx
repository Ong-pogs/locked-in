'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { AppBgm } from './AppBgm';
import { useAuth } from '@/hooks/useAuth';
import { useUserStore } from '@/stores/userStore';
import { useCourseStore } from '@/stores/courseStore';
import { useFlameStore } from '@/stores/flameStore';
import { useYieldStore } from '@/stores/yieldStore';
import { useResurfaceStore } from '@/stores/resurfaceStore';
import { getUserEnrollments } from '@/services/api/progress/progressApi';
import { fetchWithAuth } from '@/services/api';
import { T } from './theme';
import { flowGuardRedirect } from '@/lib/flowGuard';



/**
 * Flow enforcement — mirrors AppNavigator.tsx from the RN app exactly.
 *
 * 1. No wallet/JWT → landing page only
 * 2. phase 'auth' → landing page
 * 3. phase 'onboarding', no active lock → onboarding routes only
 * 4. phase 'onboarding' WITH active lock → main routes
 * 5. phase 'main' → all main routes
 */
function useFlowGuard(hydrated: boolean) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated } = useAuth();

  const phase = useUserStore((s) => s.onboardingPhase);
  const walletAddress = useUserStore((s) => s.walletAddress);
  const activeCourseIds = useCourseStore((s) => s.activeCourseIds);
  const courseStates = useCourseStore((s) => s.courseStates);

  // Check if user has an active on-chain lock (same logic as AppNavigator)
  const activeLockCourseIds = activeCourseIds.filter(
    (courseId: string) => Boolean(courseStates[courseId]?.lockAccountAddress),
  );
  const hasActiveLock = activeLockCourseIds.length > 0;

  useEffect(() => {
    // Wait for persisted stores to rehydrate before any redirect. Zustand
    // persist hydrates on the client AFTER mount, so acting on the pre-hydration
    // (empty) auth state would bounce a deep-linked, logged-in user on a
    // non-public route (e.g. /claim, /onboarding/deposit) to /village.
    if (!hydrated) return;

    // The decision itself lives in lib/flowGuard.ts so it can be unit-tested;
    // see __tests__/lib/flowGuard.test.ts. Keeping it inline here is what let
    // /arena and then /spire/[matchId] ship broken.
    const target = flowGuardRedirect({
      pathname, walletAddress, isAuthenticated, phase, hasActiveLock,
    });
    if (target && target !== pathname) router.replace(target);
  }, [hydrated, pathname, walletAddress, isAuthenticated, phase, hasActiveLock, router]);
}

/** Block rendering until persisted Zustand stores have rehydrated from localStorage.
 * Includes flame/yield/resurface — without them, UI mounted with default-zero
 * flame intensity / yield totals before the real persisted state landed. */
function useStoresHydrated(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const check = () => {
      if (
        useUserStore.persist.hasHydrated() &&
        useCourseStore.persist.hasHydrated() &&
        useFlameStore.persist.hasHydrated() &&
        useYieldStore.persist.hasHydrated() &&
        useResurfaceStore.persist.hasHydrated()
      ) {
        setReady(true);
      }
    };

    check();

    const unsubs = [
      useUserStore.persist.onFinishHydration(check),
      useCourseStore.persist.onFinishHydration(check),
      useFlameStore.persist.onFinishHydration(check),
      useYieldStore.persist.onFinishHydration(check),
      useResurfaceStore.persist.onFinishHydration(check),
    ];

    return () => unsubs.forEach((u) => u());
  }, []);

  return ready;
}

/**
 * App shell — matches AppNavigator from the mobile app.
 * Enforces onboarding flow, shows sidebar only for main routes,
 * waits for store hydration before rendering.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const hydrated = useStoresHydrated();
  const { isAuthenticated } = useAuth();
  const phase = useUserStore((s) => s.onboardingPhase);
  const activeCourseIds = useCourseStore((s) => s.activeCourseIds);
  const courseStates = useCourseStore((s) => s.courseStates);
  const pathname = usePathname();

  // Enforce flow (only after stores rehydrate — see useFlowGuard)
  useFlowGuard(hydrated);

  // App-level content sync: refresh the published lesson catalog once per app
  // load, on ANY route. Previously only /courses triggered this, so a user who
  // went dashboard → lesson kept serving a stale persisted catalog (e.g. the
  // pre-cleanup Fuel/Ichor quiz questions) indefinitely on that device.
  useEffect(() => {
    if (!hydrated) return;
    void useCourseStore.getState().initializeContent();
  }, [hydrated]);

  // Background sync: restore enrollments + progress from backend on reconnect
  // (handles case where user returns with persisted JWT but localStorage was cleared)
  useEffect(() => {
    if (!hydrated || !isAuthenticated) return;
    // fetchWithAuth auto-refreshes an expired 15-min access token. A raw-token
    // call here silently 401'd for virtually every returning user (>15 min
    // since last refresh), leaving persisted shields/streak/lapse stale on
    // app open and skipping the onboarding-phase promotion.
    fetchWithAuth((t) => getUserEnrollments(t))
      .then((data) => {
        if (!data) return;
        useCourseStore.getState().restoreFromBackend(data);
        const bestStreak = Math.max(
          ...data.enrollments.map((e) => e.runtime?.currentStreak ?? 0),
          0,
        );
        if (bestStreak > 0) {
          useFlameStore.getState().updateFromStreak(bestStreak);
        }

        // Promote returning users past onboarding when backend confirms enrollments
        // (handles case where localStorage was cleared but user already has active locks)
        if (data.enrollments.length > 0) {
          const userState = useUserStore.getState();
          if (userState.onboardingPhase !== 'main') {
            userState.setOnboardingPhase('main');
          }
          if (!userState.tutorialCompleted) {
            userState.completeTutorial();
          }
        }
      })
      .catch(() => {}); // Fail silently — local state is still usable
  }, [hydrated, isAuthenticated]);

  // Loading spinner while stores rehydrate (matches RN AppNavigator)
  if (!hydrated) {
    return (
      <div
        className="flex items-center justify-center min-h-screen"
        style={{ backgroundColor: T.bg }}
      >
        <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: `${T.amber}40`, borderTopColor: 'transparent' }} />
      </div>
    );
  }

  // Determine if sidebar should show (only in main app, not during onboarding/auth)
  const activeLockCourseIds = activeCourseIds.filter(
    (courseId: string) => Boolean(courseStates[courseId]?.lockAccountAddress),
  );
  const hasActiveLock = activeLockCourseIds.length > 0;
  const isVillageRoute = pathname.startsWith('/village');
  const isInMainApp =
    isAuthenticated &&
    (phase === 'main' || (phase === 'onboarding' && hasActiveLock));

  // Village hub IS the navigation. Sidebar + BottomNav are dropped across the
  // whole app to commit to the diegetic pattern (Hades / Stardew / Spiritfarer).
  // Each inner page provides its own "↩ Hub" floating button back to /village.
  const showChrome = false;
  // Suppress unused-var warnings while the chrome flags stick around.
  void isInMainApp;
  void isVillageRoute;

  return (
    <>
      <AppBgm />
      {showChrome && <Sidebar />}
      {showChrome && <BottomNav />}
      <main className={`flex-1 ${showChrome ? 'md:ml-[240px] pb-[calc(72px_+_env(safe-area-inset-bottom,0px))] md:pb-0' : ''}`}>
        {children}
      </main>
    </>
  );
}
