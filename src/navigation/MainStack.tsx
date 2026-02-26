import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { MainStackParamList } from './types';
import { UndergroundHubScreen } from '@/screens/main/UndergroundHubScreen';
import { CourseBrowserScreen } from '@/screens/main/CourseBrowserScreen';
import { LessonScreen } from '@/screens/main/LessonScreen';
import { LessonResultScreen } from '@/screens/main/LessonResultScreen';
import { FlameDashboardScreen } from '@/screens/main/FlameDashboardScreen';
import { AlchemyScreen } from '@/screens/main/AlchemyScreen';
import { LeaderboardScreen } from '@/screens/main/LeaderboardScreen';
import { ProfileScreen } from '@/screens/main/ProfileScreen';

const Stack = createNativeStackNavigator<MainStackParamList>();

export function MainStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0a0a0a' },
      }}
    >
      <Stack.Screen name="UndergroundHub" component={UndergroundHubScreen} />
      <Stack.Screen
        name="CourseBrowser"
        component={CourseBrowserScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Lesson"
        component={LessonScreen}
        options={{ animation: 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="LessonResult"
        component={LessonResultScreen}
        options={{ animation: 'fade' }}
      />
      <Stack.Screen
        name="FlameDashboard"
        component={FlameDashboardScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Alchemy"
        component={AlchemyScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Leaderboard"
        component={LeaderboardScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ presentation: 'modal' }}
      />
    </Stack.Navigator>
  );
}
