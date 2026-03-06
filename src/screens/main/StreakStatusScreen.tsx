import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback } from 'react';
import { useUserStore } from '@/stores';
import { useCourseStore } from '@/stores/courseStore';

export function StreakStatusScreen() {
  const navigation = useNavigation();

  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const courseStates = useCourseStore((s) => s.courseStates);
  const courses = useCourseStore((s) => s.courses);
  const refreshCourseRuntime = useCourseStore((s) => s.refreshCourseRuntime);
  const authToken = useUserStore((s) => s.authToken);

  const activeState = activeCourseId ? courseStates[activeCourseId] : null;
  const activeCourse = activeCourseId
    ? courses.find((c) => c.id === activeCourseId)
    : null;

  const streak = activeState?.currentStreak ?? 0;
  const longestStreak = activeState?.longestStreak ?? 0;
  const saverCount = activeState?.saverCount ?? 0;
  const saversRemaining = Math.max(0, 3 - saverCount);
  const gauntletActive = activeState?.gauntletActive ?? false;
  const gauntletDay = activeState?.gauntletDay ?? 1;
  const saverRecoveryMode = activeState?.saverRecoveryMode ?? false;
  const redirectPercent = Math.round((activeState?.currentYieldRedirectBps ?? 0) / 100);
  const extensionDays = activeState?.extensionDays ?? 0;

  useFocusEffect(
    useCallback(() => {
      if (activeCourseId && authToken) {
        void refreshCourseRuntime(activeCourseId, authToken).catch(() => {
          // Keep last synced runtime visible if refresh fails.
        });
      }
    }, [activeCourseId, authToken, refreshCourseRuntime]),
  );

  // Flame state derived from streak
  const flameState = streak >= 3 ? 'BURNING' : streak >= 1 ? 'LIT' : 'COLD';
  const flameColor =
    flameState === 'BURNING'
      ? 'text-amber-400'
      : flameState === 'LIT'
        ? 'text-orange-400'
        : 'text-neutral-600';

  const lampsLit = saversRemaining;

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <View className="flex-1 px-6 pt-4">
        <Pressable onPress={() => navigation.goBack()}>
          <Text className="text-neutral-400">{'\u2190'} Back</Text>
        </Pressable>

        <Text className="mt-4 text-2xl font-bold text-white">
          Streak Status
        </Text>
        {activeCourse && (
          <Text className="mt-1 text-sm text-neutral-500">
            {activeCourse.title}
          </Text>
        )}

        {/* Flame state */}
        <View className="mt-6 items-center rounded-2xl border border-neutral-700 bg-neutral-900 p-6">
          <Text className={`text-4xl font-bold ${flameColor}`}>
            {flameState}
          </Text>
          <Text className="mt-2 text-sm text-neutral-500">
            {flameState === 'BURNING'
              ? 'Your flame burns bright'
              : flameState === 'LIT'
                ? 'Your flame is lit'
                : 'Your flame is cold'}
          </Text>
        </View>

        {/* Streak info */}
        <View className="mt-4 flex-row gap-3">
          <View className="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
            <Text className="text-xs uppercase tracking-wide text-neutral-500">
              Current Streak
            </Text>
            <Text className="mt-1 text-2xl font-bold text-white">
              {streak}
            </Text>
            <Text className="mt-0.5 text-xs text-neutral-600">days</Text>
          </View>
          <View className="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
            <Text className="text-xs uppercase tracking-wide text-neutral-500">
              Longest Streak
            </Text>
            <Text className="mt-1 text-2xl font-bold text-amber-400">
              {longestStreak}
            </Text>
            <Text className="mt-0.5 text-xs text-neutral-600">days</Text>
          </View>
        </View>

        {/* Saver Lamps */}
        <View className="mt-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
          <Text className="text-xs uppercase tracking-wide text-neutral-500">
            Saver Lamps
          </Text>
          <View className="mt-3 flex-row justify-center gap-6">
            {[0, 1, 2].map((i) => (
              <View key={i} className="items-center">
                <Text className="text-3xl">
                  {i < lampsLit ? '\u{1F525}' : '\u{1F4A8}'}
                </Text>
                <Text className="mt-1 text-xs text-neutral-600">
                  {i < lampsLit ? 'Active' : 'Used'}
                </Text>
              </View>
            ))}
          </View>
          <Text className="mt-3 text-center text-xs text-neutral-500">
            {saversRemaining}/3 savers remaining
            {gauntletActive
              ? ` \u00B7 Locked during gauntlet (Day ${gauntletDay}/7)`
              : ''}
          </Text>
        </View>

        <View className="mt-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
          <Text className="text-xs uppercase tracking-wide text-neutral-500">
            Consequence State
          </Text>
          <Text className="mt-2 text-sm text-neutral-300">
            Yield redirect: {redirectPercent}%
          </Text>
          <Text className="mt-1 text-sm text-neutral-300">
            Saver recovery: {saverRecoveryMode ? 'Active' : 'Inactive'}
          </Text>
          <Text className="mt-1 text-sm text-neutral-300">
            Extension total: {extensionDays} day{extensionDays !== 1 ? 's' : ''}
          </Text>
        </View>

        {/* Gauntlet status */}
        {gauntletActive && (
          <View className="mt-4 rounded-xl border border-purple-500/30 bg-purple-500/10 p-4">
            <Text className="text-sm font-semibold text-purple-400">
              Gauntlet Active
            </Text>
            <Text className="mt-1 text-xs text-neutral-500">
              Day {gauntletDay} of 7 — no savers allowed
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
