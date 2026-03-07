import { useUserStore } from '@/stores';
import { useCourseStore } from '@/stores/courseStore';
import { AuthStack } from './AuthStack';
import { OnboardingStack } from './OnboardingStack';
import { MainStack } from './MainStack';

export function AppNavigator() {
  const phase = useUserStore((s) => s.onboardingPhase);
  const walletAddress = useUserStore((s) => s.walletAddress);
  const walletAuthToken = useUserStore((s) => s.walletAuthToken);
  const activeCourseIds = useCourseStore((s) => s.activeCourseIds);
  const courseStates = useCourseStore((s) => s.courseStates);

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
    case 'gauntlet':
      return <OnboardingStack />;
    case 'main':
      return <MainStack />;
  }
}
