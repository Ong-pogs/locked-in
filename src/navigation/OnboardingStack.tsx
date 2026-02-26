import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { OnboardingStackParamList } from './types';
import { CourseSelectionScreen } from '@/screens/onboarding/CourseSelectionScreen';
import { DepositScreen } from '@/screens/onboarding/DepositScreen';
import { GauntletRoomScreen } from '@/screens/onboarding/GauntletRoomScreen';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

export function OnboardingStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="CourseSelection" component={CourseSelectionScreen} />
      <Stack.Screen name="Deposit" component={DepositScreen} />
      <Stack.Screen name="GauntletRoom" component={GauntletRoomScreen} />
    </Stack.Navigator>
  );
}
