import { Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { MainTabsParamList } from './types';
import { HomeScreen } from '@/screens/main/HomeScreen';
import { CourseBrowserScreen } from '@/screens/main/CourseBrowserScreen';
import { UndergroundHubScreen } from '@/screens/main/UndergroundHubScreen';
import { ProfileScreen } from '@/screens/main/ProfileScreen';

const Tab = createBottomTabNavigator<MainTabsParamList>();

const TAB_ICONS: Record<string, string> = {
  Home: '\u2302',     // ⌂
  Courses: '\u2261',  // ≡
  Dungeon: '\u2694',  // ⚔
  Profile: '\u2662',  // ♢
};

export function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0a0a0c',
          borderTopColor: '#1c1c1e',
          borderTopWidth: 1,
          height: 80,
          paddingBottom: 20,
          paddingTop: 8,
        },
        tabBarActiveTintColor: '#f59e0b',
        tabBarInactiveTintColor: '#737373',
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600' as const,
        },
        tabBarIcon: ({ color }) => (
          <Text style={{ color, fontSize: 22 }}>
            {TAB_ICONS[route.name] ?? '?'}
          </Text>
        ),
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Courses" component={CourseBrowserScreen} />
      <Tab.Screen name="Dungeon" component={UndergroundHubScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
