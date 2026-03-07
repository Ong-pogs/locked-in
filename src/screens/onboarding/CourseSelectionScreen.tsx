import { useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { OnboardingStackParamList } from '@/navigation/types';
import { useCourseStore } from '@/stores';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'CourseSelection'>;

export function CourseSelectionScreen() {
  const navigation = useNavigation<Nav>();
  const courses = useCourseStore((s) => s.courses);
  const contentLoading = useCourseStore((s) => s.contentLoading);
  const contentError = useCourseStore((s) => s.contentError);
  const contentInitialized = useCourseStore((s) => s.contentInitialized);
  const initializeContent = useCourseStore((s) => s.initializeContent);
  const availableCourses = courses.slice(0, 3);

  useEffect(() => {
    if (!contentInitialized && !contentLoading) {
      void initializeContent(__DEV__);
    }
  }, [contentInitialized, contentLoading, initializeContent]);

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-2xl font-bold text-white">Choose Your Path</Text>
        <Text className="mt-2 text-center text-neutral-400">
          Select a course to begin the gauntlet
        </Text>

        {availableCourses.map((course, index) => (
          <Pressable
            key={course.id}
            className={`w-full rounded-xl border border-neutral-700 bg-neutral-900 p-4 active:bg-neutral-800 ${index === 0 ? 'mt-8' : 'mt-4'}`}
            onPress={() => navigation.navigate('Deposit', { courseId: course.id })}
          >
            <Text className="text-lg font-semibold text-white">
              {course.title}
            </Text>
            <Text className="mt-1 text-sm text-neutral-400">
              {course.description}
            </Text>
          </Pressable>
        ))}

        {availableCourses.length === 0 ? (
          <View className="mt-8 items-center">
            <Text className="text-center text-sm text-neutral-500">
              {contentLoading
                ? 'Course catalog is still loading.'
                : contentError ?? 'Unable to load course catalog.'}
            </Text>
            {contentError ? (
              <Pressable
                className="mt-4 rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 active:opacity-80"
                onPress={() => {
                  void initializeContent(true);
                }}
              >
                <Text className="text-sm font-semibold text-white">Retry</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
