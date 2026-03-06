import { useCallback } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useUserStore } from '@/stores';
import { useCourseStore } from '@/stores/courseStore';

export function CommunityPotScreen() {
  const navigation = useNavigation();

  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const activeCourseIds = useCourseStore((s) => s.activeCourseIds);
  const courseStates = useCourseStore((s) => s.courseStates);
  const courses = useCourseStore((s) => s.courses);
  const refreshCourseRuntime = useCourseStore((s) => s.refreshCourseRuntime);
  const authToken = useUserStore((s) => s.authToken);

  // Community pot = ichor redirected from missed-lesson saver penalties
  // For now, show totalIchorProduced as a proxy for pot contributions
  // (in production this would be a separate on-chain pot)
  const totalPotIchor = activeCourseIds.reduce(
    (sum, id) => sum + (courseStates[id]?.totalIchorProduced ?? 0),
    0,
  );

  useFocusEffect(
    useCallback(() => {
      if (!authToken) {
        return;
      }

      for (const courseId of activeCourseIds) {
        void refreshCourseRuntime(courseId, authToken).catch(() => {
          // Keep last synced runtime visible if refresh fails.
        });
      }
    }, [activeCourseIds, authToken, refreshCourseRuntime]),
  );

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <ScrollView className="flex-1 px-6 pt-4">
        <Pressable onPress={() => navigation.goBack()}>
          <Text className="text-neutral-400">{'\u2190'} Back</Text>
        </Pressable>

        <Text className="mt-4 text-2xl font-bold text-white">
          Community Pot
        </Text>
        <Text className="mt-1 text-sm text-neutral-500">
          Ichor redirected from missed lessons
        </Text>

        {/* Pot Balance */}
        <View className="mt-6 items-center rounded-2xl border border-purple-500/30 bg-purple-500/10 p-6">
          <Text className="text-xs font-semibold uppercase tracking-wider text-purple-400">
            Pot Balance
          </Text>
          <Text className="mt-2 text-4xl font-bold text-purple-300">
            {Math.floor(totalPotIchor).toLocaleString()}
          </Text>
          <Text className="mt-1 text-sm text-neutral-500">Ichor</Text>
        </View>

        {/* Per-course breakdown */}
        {activeCourseIds.length > 0 && (
          <View className="mt-6">
            <Text className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
              Per Course
            </Text>
            {activeCourseIds.map((courseId) => {
              const state = courseStates[courseId];
              const course = courses.find((c) => c.id === courseId);
              if (!state || !course) return null;
              const isActive = courseId === activeCourseId;

              return (
                <View
                  key={courseId}
                  className={`mb-3 rounded-xl border p-4 ${
                    isActive
                      ? 'border-purple-500/50 bg-purple-500/5'
                      : 'border-neutral-700 bg-neutral-900'
                  }`}
                >
                  <View className="flex-row items-center justify-between">
                    <Text className="text-base font-semibold text-white">
                      {course.title.length > 20
                        ? course.title.slice(0, 20) + '\u2026'
                        : course.title}
                    </Text>
                    {isActive && (
                      <View className="rounded-full bg-purple-500/20 px-2 py-0.5">
                        <Text className="text-xs text-purple-400">Active</Text>
                      </View>
                    )}
                  </View>
                  <View className="mt-2 flex-row gap-4">
                    <Text className="text-sm text-purple-400">
                      {Math.floor(state.totalIchorProduced)} Ichor redirected
                    </Text>
                    <Text className="text-sm text-neutral-500">
                      Savers remaining: {Math.max(0, 3 - state.saverCount)}/3
                    </Text>
                  </View>
                  <Text className="mt-2 text-xs text-neutral-500">
                    Current redirect: {Math.round((state.currentYieldRedirectBps ?? 0) / 100)}%
                    {' \u00B7 '}
                    Extension: {state.extensionDays ?? 0} day
                    {(state.extensionDays ?? 0) !== 1 ? 's' : ''}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* How it works */}
        <View className="mt-6 mb-8 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
          <Text className="text-sm font-semibold text-neutral-400">
            How the Pot Fills
          </Text>
          <Text className="mt-2 text-xs leading-5 text-neutral-500">
            {'\u2022'} Miss a lesson and use a Saver{'\n'}
            {'\u2022'} 1st Saver: 10% of your dungeon Ichor to pot{'\n'}
            {'\u2022'} 2nd Saver: 20% of your dungeon Ichor to pot{'\n'}
            {'\u2022'} 3rd Saver: 100% of your dungeon Ichor to pot{'\n'}
            {'\u2022'} No savers left: lock period extended
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
