import { useCallback } from 'react';
import { Alert, View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MainStackParamList } from '@/navigation/types';
import { disconnectWallet } from '@/services/solana';
import { useUserStore } from '@/stores';
import { useCourseStore } from '@/stores/courseStore';

type Nav = NativeStackNavigationProp<MainStackParamList>;

export function ProfileScreen() {
  const navigation = useNavigation<Nav>();

  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const activeCourseIds = useCourseStore((s) => s.activeCourseIds);
  const courseStates = useCourseStore((s) => s.courseStates);
  const courses = useCourseStore((s) => s.courses);
  const setActiveCourse = useCourseStore((s) => s.setActiveCourse);
  const deactivateCourse = useCourseStore((s) => s.deactivateCourse);
  const refreshCourseRuntime = useCourseStore((s) => s.refreshCourseRuntime);
  const resetLessonProgressForCourse = useCourseStore(
    (s) => s.resetLessonProgressForCourse,
  );

  const activeState = activeCourseId ? courseStates[activeCourseId] : null;
  const activeCourse = activeCourseId
    ? courses.find((c) => c.id === activeCourseId)
    : null;
  const authToken = useUserStore((s) => s.authToken);
  const walletAuthToken = useUserStore((s) => s.walletAuthToken);
  const disconnect = useUserStore((s) => s.disconnect);

  const streak = activeState?.currentStreak ?? 0;
  const ichor = activeState?.ichorBalance ?? 0;
  const fuel = activeState?.fuelCounter ?? 0;
  const fuelCap = activeState?.fuelCap ?? 7;
  const saverCount = activeState?.saverCount ?? 0;

  useFocusEffect(
    useCallback(() => {
      if (activeCourseId && authToken) {
        void refreshCourseRuntime(activeCourseId, authToken).catch(() => {
          // Keep last synced runtime visible if refresh fails.
        });
      }
    }, [activeCourseId, authToken, refreshCourseRuntime]),
  );

  const menuItems = [
    { label: 'Streak Status', screen: 'StreakStatus' as const, icon: '\u2739' },
    { label: 'Leaderboard', screen: 'Leaderboard' as const, icon: '\u2694' },
    { label: 'Ichor Shop', screen: 'IchorShop' as const, icon: '\u2697' },
    { label: 'Community Pot', screen: 'CommunityPot' as const, icon: '\u26b2' },
    { label: 'Inventory', screen: 'Inventory' as const, icon: '\u2692' },
  ];

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <ScrollView className="flex-1 px-6 pt-4">
        <Pressable onPress={() => navigation.goBack()}>
          <Text className="text-neutral-400">{'\u2190'} Back</Text>
        </Pressable>

        <Text className="mt-4 text-2xl font-bold text-white">Profile</Text>
        {activeCourse && (
          <Text className="mt-1 text-sm text-neutral-500">
            {activeCourse.title}
          </Text>
        )}

        {/* Stats row */}
        <View className="mt-6 flex-row gap-3">
          <View className="flex-1 items-center rounded-xl border border-neutral-700 bg-neutral-900 p-3">
            <Text className="text-xs uppercase text-neutral-500">Streak</Text>
            <Text className="mt-1 text-xl font-bold text-white">{streak}</Text>
          </View>
          <View className="flex-1 items-center rounded-xl border border-neutral-700 bg-neutral-900 p-3">
            <Text className="text-xs uppercase text-neutral-500">Ichor</Text>
            <Text className="mt-1 text-xl font-bold text-amber-400">
              {Math.floor(ichor)}
            </Text>
          </View>
          <View className="flex-1 items-center rounded-xl border border-neutral-700 bg-neutral-900 p-3">
            <Text className="text-xs uppercase text-neutral-500">Fuel</Text>
            <Text className="mt-1 text-xl font-bold text-orange-400">
              {fuel}
              <Text className="text-sm text-neutral-600">/{fuelCap}</Text>
            </Text>
          </View>
          <View className="flex-1 items-center rounded-xl border border-neutral-700 bg-neutral-900 p-3">
            <Text className="text-xs uppercase text-neutral-500">Savers</Text>
            <Text className="mt-1 text-xl font-bold text-purple-400">
              {3 - saverCount}/3
            </Text>
          </View>
        </View>

        {/* Course Switcher */}
        {activeCourseIds.length > 1 && (
          <View className="mt-6">
            <Text className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
              Switch Course
            </Text>
            {activeCourseIds.map((courseId) => {
              const course = courses.find((c) => c.id === courseId);
              if (!course) return null;
              const isActive = courseId === activeCourseId;
              return (
                <Pressable
                  key={courseId}
                  className={`mb-2 rounded-xl border p-3 ${
                    isActive
                      ? 'border-amber-500/50 bg-amber-500/10'
                      : 'border-neutral-700 bg-neutral-900'
                  } active:opacity-80`}
                  onPress={() => {
                    setActiveCourse(courseId);
                    navigation.goBack();
                  }}
                >
                  <Text
                    className={`text-sm font-semibold ${
                      isActive ? 'text-amber-400' : 'text-white'
                    }`}
                  >
                    {course.title}
                    {isActive ? ' (active)' : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Menu Items */}
        <View className="mt-6">
          {menuItems.map((item) => (
            <Pressable
              key={item.screen}
              className="flex-row items-center gap-4 border-b border-neutral-800 py-4 active:opacity-70"
              onPress={() => navigation.navigate(item.screen)}
            >
              <Text className="w-6 text-center text-lg text-neutral-500">
                {item.icon}
              </Text>
              <Text className="text-base font-medium text-white">
                {item.label}
              </Text>
              <Text className="ml-auto text-neutral-600">{'\u203A'}</Text>
            </Pressable>
          ))}
        </View>

        {/* Danger zone */}
        <View className="mt-6 gap-3 pb-8">
          {__DEV__ && activeCourseId && (
            <Pressable
              className="rounded-xl border border-amber-500/30 bg-amber-500/10 py-3 active:opacity-80"
              onPress={() => {
                Alert.alert(
                  'Reset Lesson Progress',
                  'This clears local lesson completion for the active course so you can retake it.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Reset',
                      style: 'destructive',
                      onPress: () => {
                        resetLessonProgressForCourse(activeCourseId);
                        navigation.goBack();
                      },
                    },
                  ],
                );
              }}
            >
              <Text className="text-center text-sm font-semibold text-amber-300">
                Reset Lesson Progress
              </Text>
            </Pressable>
          )}
          <Pressable
            className="rounded-xl border border-neutral-700 bg-neutral-900 py-3 active:opacity-80"
            onPress={() => {
              if (activeCourseId) {
                deactivateCourse(activeCourseId);
                if (activeCourseIds.length <= 1) {
                  navigation.replace('CourseBrowser');
                } else {
                  navigation.goBack();
                }
              }
            }}
          >
            <Text className="text-center text-sm font-semibold text-neutral-400">
              Exit Course
            </Text>
          </Pressable>
          <Pressable
            className="rounded-xl border border-red-500/30 bg-red-500/10 py-3 active:opacity-80"
            onPress={() => {
              Alert.alert(
                'Disconnect Wallet',
                'This clears the cached wallet session on the device and in the wallet app.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Disconnect',
                    style: 'destructive',
                    onPress: () => {
                      void disconnectWallet(walletAuthToken ?? '').finally(() => {
                        disconnect();
                      });
                    },
                  },
                ],
              );
            }}
          >
            <Text className="text-center text-sm font-semibold text-red-400">
              Disconnect
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
