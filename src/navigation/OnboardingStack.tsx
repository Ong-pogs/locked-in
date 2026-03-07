import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { OnboardingStackParamList } from './types';
import { CourseSelectionScreen } from '@/screens/onboarding/CourseSelectionScreen';
import { DepositScreen } from '@/screens/onboarding/DepositScreen';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

export function OnboardingStack() {
  return (
    <Stack.Navigator
      initialRouteName="CourseSelection"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="CourseSelection" component={CourseSelectionScreen} />
      <Stack.Screen name="Deposit" component={DepositScreen} />
    </Stack.Navigator>
  );
}
