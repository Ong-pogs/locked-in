import { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MainStackParamList } from '@/navigation/types';
import { useCourseStore } from '@/stores/courseStore';
import type { Course } from '@/types';

type Nav = NativeStackNavigationProp<MainStackParamList>;

const DIFFICULTY_COLORS = {
  beginner: 'bg-green-900 text-green-400',
  intermediate: 'bg-amber-900 text-amber-400',
  advanced: 'bg-red-900 text-red-400',
} as const;

const CATEGORY_COLORS: Record<string, string> = {
  solana: 'bg-purple-900 text-purple-400',
  web3: 'bg-blue-900 text-blue-400',
  defi: 'bg-emerald-900 text-emerald-400',
  security: 'bg-red-900 text-red-400',
  rust: 'bg-orange-900 text-orange-400',
};

export function CourseBrowserScreen() {
  const navigation = useNavigation<Nav>();
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);

  // Initialize mock data (synchronous, idempotent)
  useCourseStore.getState().initializeMockData();

  const courses = useCourseStore((s) => s.courses);
  const lessons = useCourseStore((s) => s.lessons);
  const lessonProgress = useCourseStore((s) => s.lessonProgress);
  const activeCourseIds = useCourseStore((s) => s.activeCourseIds);
  const courseStates = useCourseStore((s) => s.courseStates);
  const activateCourse = useCourseStore((s) => s.activateCourse);
  const setActiveCourse = useCourseStore((s) => s.setActiveCourse);
  const deactivateCourse = useCourseStore((s) => s.deactivateCourse);

  // Mode detection
  const isMainMenu = activeCourseIds.length === 0;
  const activeCourses = courses.filter((c) => activeCourseIds.includes(c.id));
  const availableCourses = courses.filter((c) => !activeCourseIds.includes(c.id));

  const selectedCourse = selectedCourseId
    ? courses.find((c) => c.id === selectedCourseId) ?? null
    : null;
  const selectedLessons = selectedCourseId
    ? (lessons[selectedCourseId] ?? [])
    : [];

  // Handle dev-mode enroll: activate + navigate to dungeon
  const handleEnroll = (courseId: string) => {
    activateCourse(courseId, 100, 30); // mock $100, 30 days
    navigation.navigate('DungeonHome');
  };

  // Handle tapping an active course card: switch + go to dungeon
  const handleActiveCoursePress = (courseId: string) => {
    setActiveCourse(courseId);
    navigation.navigate('DungeonHome');
  };

  // ====== Detail View ======
  if (selectedCourse) {
    const isActive = activeCourseIds.includes(selectedCourse.id);
    const state = courseStates[selectedCourse.id];

    return (
      <SafeAreaView className="flex-1 bg-neutral-950">
        <ScrollView className="flex-1 px-6 pt-4">
          {/* Header */}
          <Pressable onPress={() => setSelectedCourseId(null)}>
            <Text className="text-neutral-400">{'\u2190'} Back to Courses</Text>
          </Pressable>

          <Text className="mt-4 text-2xl font-bold text-white">
            {selectedCourse.title}
          </Text>

          {/* Action button */}
          {isActive ? (
            <View className="mt-3 gap-2">
              <Pressable
                className="rounded-xl bg-purple-600 px-5 py-3 active:opacity-80"
                onPress={() => handleActiveCoursePress(selectedCourse.id)}
              >
                <Text className="text-center font-bold text-white">
                  DESCEND
                </Text>
              </Pressable>
              <Pressable
                className="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-2.5 active:opacity-80"
                onPress={() => {
                  deactivateCourse(selectedCourse.id);
                  setSelectedCourseId(null);
                }}
              >
                <Text className="text-center text-sm font-semibold text-red-400">
                  Exit Course
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              className="mt-3 rounded-xl bg-purple-600 px-5 py-3 active:opacity-80"
              onPress={() => handleEnroll(selectedCourse.id)}
            >
              <Text className="text-center font-bold text-white">
                DESCEND
              </Text>
            </Pressable>
          )}

          {/* Progress summary */}
          <View className="mt-3 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
            <Text className="text-sm text-neutral-400">Progress</Text>
            <View className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-800">
              <View
                className="h-full rounded-full bg-amber-500"
                style={{
                  width: `${selectedCourse.totalLessons > 0 ? (selectedCourse.completedLessons / selectedCourse.totalLessons) * 100 : 0}%`,
                }}
              />
            </View>
            <Text className="mt-1 text-xs text-neutral-500">
              {selectedCourse.completedLessons}/{selectedCourse.totalLessons}{' '}
              lessons completed
            </Text>
            {isActive && state && (
              <View className="mt-2 flex-row gap-4">
                <Text className="text-xs text-amber-400">
                  {'\u2739'} Streak: {state.currentStreak}
                </Text>
                <Text className="text-xs text-purple-400">
                  Day {state.gauntletDay}
                </Text>
              </View>
            )}
          </View>

          {/* Lesson list */}
          <View className="mt-6 gap-3 pb-8">
            {selectedLessons
              .sort((a, b) => a.order - b.order)
              .map((lesson) => {
                const progress = lessonProgress[lesson.id];
                const isCompleted = progress?.completed;

                return (
                  <Pressable
                    key={lesson.id}
                    className="flex-row items-center rounded-xl border border-neutral-700 bg-neutral-900 p-4 active:bg-neutral-800"
                    onPress={() =>
                      navigation.navigate('Lesson', {
                        lessonId: lesson.id,
                        courseId: selectedCourse.id,
                      })
                    }
                  >
                    {/* Order number circle */}
                    <View
                      className={`h-10 w-10 items-center justify-center rounded-full ${
                        isCompleted
                          ? 'bg-green-900'
                          : 'bg-neutral-800'
                      }`}
                    >
                      {isCompleted ? (
                        <Text className="text-lg text-green-400">{'\u2713'}</Text>
                      ) : (
                        <Text className="text-lg font-bold text-neutral-400">
                          {lesson.order}
                        </Text>
                      )}
                    </View>

                    {/* Lesson info */}
                    <View className="ml-4 flex-1">
                      <Text className="text-base font-semibold text-white">
                        {lesson.title}
                      </Text>
                      {isCompleted && progress?.score != null && (
                        <Text className="mt-0.5 text-sm text-neutral-500">
                          Score: {progress.score}%
                        </Text>
                      )}
                    </View>

                    {/* Chevron */}
                    {!isCompleted && (
                      <Text className="text-neutral-600">{'\u203A'}</Text>
                    )}
                  </Pressable>
                );
              })}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ====== List View ======
  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <ScrollView className="flex-1 px-6 pt-4">
        {/* Header: mode-dependent */}
        {isMainMenu || !navigation.canGoBack() ? (
          <Text className="text-2xl font-bold text-white">Locked In</Text>
        ) : (
          <>
            <Pressable onPress={() => navigation.goBack()}>
              <Text className="text-neutral-400">{'\u2190'} Back</Text>
            </Pressable>
            <Text className="mt-4 text-2xl font-bold text-white">Courses</Text>
          </>
        )}

        {/* Active Courses Section */}
        {activeCourses.length > 0 && (
          <View className="mt-6">
            <Text className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
              Active Courses
            </Text>
            <View className="gap-3">
              {activeCourses.map((course) => {
                const state = courseStates[course.id];
                return (
                  <Pressable
                    key={course.id}
                    className="flex-row items-center rounded-xl border border-purple-500/50 bg-purple-500/10 p-4 active:bg-purple-500/20"
                    onPress={() => handleActiveCoursePress(course.id)}
                  >
                    <View className="flex-1">
                      <Text className="text-base font-bold text-white">
                        {course.title}
                      </Text>
                      <View className="mt-1 flex-row items-center gap-3">
                        <Text className="text-xs text-amber-400">
                          {'\u2739'} {state?.currentStreak ?? 0} streak
                        </Text>
                        <Text className="text-xs text-purple-400">
                          Day {state?.gauntletDay ?? 1}
                        </Text>
                        <Text className="text-xs text-neutral-500">
                          {course.completedLessons}/{course.totalLessons} lessons
                        </Text>
                      </View>
                    </View>
                    <Text className="text-neutral-500">{'\u203A'}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {/* Available Courses */}
        <View className="mt-6">
          {activeCourses.length > 0 && (
            <Text className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
              Available Courses
            </Text>
          )}
          <View className="gap-4 pb-8">
            {(activeCourses.length > 0 ? availableCourses : courses).map((course) => (
              <CourseCard
                key={course.id}
                course={course}
                onPress={() => setSelectedCourseId(course.id)}
                onEnroll={() => handleEnroll(course.id)}
              />
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function CourseCard({
  course,
  onPress,
  onEnroll,
}: {
  course: Course;
  onPress: () => void;
  onEnroll: () => void;
}) {
  const progressPercent =
    course.totalLessons > 0
      ? (course.completedLessons / course.totalLessons) * 100
      : 0;

  const difficultyStyle = DIFFICULTY_COLORS[course.difficulty];
  const categoryStyle = CATEGORY_COLORS[course.category] ?? 'bg-neutral-800 text-neutral-400';

  return (
    <Pressable
      className="rounded-xl border border-neutral-700 bg-neutral-900 p-6 active:bg-neutral-800"
      onPress={onPress}
    >
      {/* Pills row */}
      <View className="flex-row items-center gap-2">
        <View className={`rounded-full px-3 py-1 ${categoryStyle.split(' ')[0]}`}>
          <Text className={`text-xs font-medium ${categoryStyle.split(' ')[1]}`}>
            {course.category}
          </Text>
        </View>
        <View className={`rounded-full px-3 py-1 ${difficultyStyle.split(' ')[0]}`}>
          <Text className={`text-xs font-medium ${difficultyStyle.split(' ')[1]}`}>
            {course.difficulty}
          </Text>
        </View>
      </View>

      {/* Title & description */}
      <Text className="mt-3 text-lg font-bold text-white">{course.title}</Text>
      <Text className="mt-1 text-sm text-neutral-400" numberOfLines={2}>
        {course.description}
      </Text>

      {/* Progress bar */}
      <View className="mt-4 h-2 overflow-hidden rounded-full bg-neutral-800">
        <View
          className="h-full rounded-full bg-amber-500"
          style={{ width: `${progressPercent}%` }}
        />
      </View>
      <Text className="mt-1 text-xs text-neutral-500">
        {course.completedLessons}/{course.totalLessons} lessons
      </Text>

      {/* Enroll button */}
      <Pressable
        className="mt-3 rounded-lg bg-purple-600 px-4 py-2 active:opacity-80"
        onPress={(e) => {
          e.stopPropagation?.();
          onEnroll();
        }}
      >
        <Text className="text-center text-sm font-bold text-white">
          DESCEND
        </Text>
      </Pressable>
    </Pressable>
  );
}
