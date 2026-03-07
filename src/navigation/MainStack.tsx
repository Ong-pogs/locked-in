import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import type { MainStackParamList } from './types';
import { UndergroundHubScreen } from '@/screens/main/UndergroundHubScreen';
import { CourseBrowserScreen } from '@/screens/main/CourseBrowserScreen';
import { LessonScreen } from '@/screens/main/LessonScreen';
import { LessonResultScreen } from '@/screens/main/LessonResultScreen';
import { StreakStatusScreen } from '@/screens/main/StreakStatusScreen';
import { AlchemyScreen } from '@/screens/main/AlchemyScreen';
import { LeaderboardScreen } from '@/screens/main/LeaderboardScreen';
import { CommunityPotScreen } from '@/screens/main/CommunityPotScreen';
import { CommunityPotWindowScreen } from '@/screens/main/CommunityPotWindowScreen';
import { ProfileScreen } from '@/screens/main/ProfileScreen';
import { InventoryScreen } from '@/screens/main/InventoryScreen';
import { IchorShopScreen } from '@/screens/main/IchorShopScreen';
import { ResurfaceHistoryScreen } from '@/screens/main/ResurfaceHistoryScreen';
import { useCourseStore } from '@/stores/courseStore';

const Stack = createNativeStackNavigator<MainStackParamList>();

export function MainStack() {
  const initializeContent = useCourseStore((s) => s.initializeContent);

  useEffect(() => {
    // In dev, always re-fetch once when entering main flow so backend wiring
    // issues are visible immediately in logs.
    initializeContent(__DEV__).catch(() => {
      // Course store handles fallback and error state.
    });
  }, [initializeContent]);

  return (
    <Stack.Navigator
      initialRouteName="CourseBrowser"
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0a0a0a' },
      }}
    >
      <Stack.Screen name="DungeonHome" component={UndergroundHubScreen} />
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
        name="StreakStatus"
        component={StreakStatusScreen}
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
        name="CommunityPot"
        component={CommunityPotScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="CommunityPotWindow"
        component={CommunityPotWindowScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Inventory"
        component={InventoryScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="IchorShop"
        component={IchorShopScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="ResurfaceHistory"
        component={ResurfaceHistoryScreen}
        options={{ animation: 'slide_from_right' }}
      />
    </Stack.Navigator>
  );
}
