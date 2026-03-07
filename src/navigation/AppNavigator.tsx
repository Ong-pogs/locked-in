import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useUserStore } from '@/stores';
import { useCourseStore } from '@/stores/courseStore';
import { AuthStack } from './AuthStack';
import { OnboardingStack } from './OnboardingStack';
import { MainStack } from './MainStack';

/** Block navigation until persisted stores have rehydrated from AsyncStorage. */
function useStoresHydrated(): boolean {
  const [ready, setReady] = useState(
    () =>
      useUserStore.persist.hasHydrated() &&
      useCourseStore.persist.hasHydrated(),
  );

  useEffect(() => {
    if (ready) return;

    const unsubs: (() => void)[] = [];
    const check = () => {
      if (
        useUserStore.persist.hasHydrated() &&
        useCourseStore.persist.hasHydrated()
      ) {
        setReady(true);
        unsubs.forEach((u) => u());
      }
    };

    unsubs.push(useUserStore.persist.onFinishHydration(check));
    unsubs.push(useCourseStore.persist.onFinishHydration(check));
    check();

    return () => unsubs.forEach((u) => u());
  }, [ready]);

  return ready;
}

export function AppNavigator() {
  const hydrated = useStoresHydrated();
  const phase = useUserStore((s) => s.onboardingPhase);
  const walletAddress = useUserStore((s) => s.walletAddress);
  const walletAuthToken = useUserStore((s) => s.walletAuthToken);
  const activeCourseIds = useCourseStore((s) => s.activeCourseIds);
  const courseStates = useCourseStore((s) => s.courseStates);

  // Wait for stores to load from disk before making routing decisions.
  if (!hydrated) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#a855f7" />
      </View>
    );
  }

  // Hard auth gate: main/onboarding screens require a cached wallet session.
  if (!walletAddress || !walletAuthToken) {
    return <AuthStack />;
  }

  const activeLockCourseIds = activeCourseIds.filter(
    (courseId) => Boolean(courseStates[courseId]?.lockAccountAddress),
  );
  const hasActiveLock = activeLockCourseIds.length > 0;

  // Go straight to dungeon if there's an active lock (gauntlet skip is in Profile)
  if ((phase === 'onboarding' || phase === 'gauntlet') && hasActiveLock) {
    return <MainStack />;
  }

  switch (phase) {
    case 'auth':
      return <AuthStack />;
    case 'onboarding':
      return <OnboardingStack />;
    case 'gauntlet':
      // Always send to MainStack — CourseBrowser lets user re-deposit
      // (DepositScreen detects existing on-chain locks automatically)
      return <MainStack />;
    case 'main':
      return <MainStack />;
  }
}
