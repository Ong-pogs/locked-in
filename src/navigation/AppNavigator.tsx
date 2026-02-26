import { useUserStore } from '@/stores';
import { AuthStack } from './AuthStack';
import { OnboardingStack } from './OnboardingStack';
import { MainStack } from './MainStack';

export function AppNavigator() {
  const phase = useUserStore((s) => s.onboardingPhase);

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
