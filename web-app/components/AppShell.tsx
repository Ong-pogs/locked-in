'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { useAuth } from '@/hooks/useAuth';
import { useUserStore } from '@/stores/userStore';
import { useCourseStore } from '@/stores/courseStore';
import { useFlameStore } from '@/stores/flameStore';
import { getUserEnrollments } from '@/services/api/progress/progressApi';
import { T } from './theme';

// Routes that don't require authentication
// Pages new users can browse without a wallet connected. Only "do something"
// flows (deposit / brew / redeem / lessons) gate on auth.
const PUBLIC_ROUTES = [
  '/courses',
  '/village',
  '/menu',
  '/dashboard',
  '/shop',
  '/alchemy',
  '/community-pot',
  '/inventory',
  '/leaderboard',
];

// Routes allowed during onboarding (before active lock)
const ONBOARDING_ROUTES = ['/courses', '/onboarding/deposit', '/onboarding/tutorial'];

/**
 * Flow enforcement — mirrors AppNavigator.tsx from the RN app exactly.
 *
 * 1. No wallet/JWT → landing page only
 * 2. phase 'auth' → landing page
 * 3. phase 'onboarding', no active lock → onboarding routes only
 * 4. phase 'onboarding' WITH active lock → main routes
 * 5. phase 'main' → all main routes
 */
function useFlowGuard() {
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
    // Skip guard on public routes
    if (PUBLIC_ROUTES.includes(pathname)) return;

    // Gate 1: No wallet/JWT → village hub (they can browse without auth)
    if (!walletAddress || !isAuthenticated) {
      router.replace('/village');
      return;
    }

    // Gate 2: phase 'auth' → village
    if (phase === 'auth') {
      router.replace('/village');
      return;
    }

    // Gate 3: phase 'onboarding' WITH active lock → allow main routes + deposit
    if (phase === 'onboarding' && hasActiveLock) {
      // Allow deposit page (enrolling in additional courses)
      if (pathname.startsWith('/onboarding/deposit')) return;
      // Other onboarding routes → redirect to courses
      if (ONBOARDING_ROUTES.includes(pathname)) {
        router.replace('/courses');
      }
      return;
    }

    // Gate 4: phase 'onboarding', no active lock → onboarding routes only
    if (phase === 'onboarding') {
      const isOnboardingRoute = ONBOARDING_ROUTES.some((r) => pathname.startsWith(r));
      if (!isOnboardingRoute) {
        router.replace('/courses');
      }
      return;
    }

    // Gate 5: phase 'main' → allow everything
    // (no redirect needed)
  }, [pathname, walletAddress, isAuthenticated, phase, hasActiveLock, router]);
}

/** Block rendering until persisted Zustand stores have rehydrated from localStorage */
function useStoresHydrated(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const check = () => {
      if (
        useUserStore.persist.hasHydrated() &&
        useCourseStore.persist.hasHydrated()
      ) {
        setReady(true);
      }
    };

    // Check immediately
    check();

    // Listen for hydration
    const unsubs = [
      useUserStore.persist.onFinishHydration(check),
      useCourseStore.persist.onFinishHydration(check),
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

  // Enforce flow
  useFlowGuard();

  // Background sync: restore enrollments + progress from backend on reconnect
  // (handles case where user returns with persisted JWT but localStorage was cleared)
  useEffect(() => {
    if (!hydrated || !isAuthenticated) return;
    const token = useUserStore.getState().authToken;
    if (!token) return;
    getUserEnrollments(token)
      .then((data) => {
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
      {showChrome && <Sidebar />}
      {showChrome && <BottomNav />}
      <main className={`flex-1 ${showChrome ? 'md:ml-[240px] pb-[calc(72px_+_env(safe-area-inset-bottom,0px))] md:pb-0' : ''}`}>
        {children}
      </main>
    </>
  );
}
