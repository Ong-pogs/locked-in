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
  const enrolledCourseIds = useCourseStore((s) => s.enrolledCourseIds);
  const enrollCourse = useCourseStore((s) => s.enrollCourse);
  const unenrollCourse = useCourseStore((s) => s.unenrollCourse);

  const selectedCourse = selectedCourseId
    ? courses.find((c) => c.id === selectedCourseId) ?? null
    : null;
  const selectedLessons = selectedCourseId
    ? (lessons[selectedCourseId] ?? [])
    : [];

  if (selectedCourse) {
    const isEnrolled = enrolledCourseIds.includes(selectedCourse.id);

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

          {/* Enroll / Unenroll button */}
          <Pressable
            className={`mt-3 rounded-xl px-5 py-3 ${
              isEnrolled
                ? 'border border-amber-500 bg-amber-500/10'
                : 'bg-amber-500'
            } active:opacity-80`}
            onPress={() =>
              isEnrolled
                ? unenrollCourse(selectedCourse.id)
                : enrollCourse(selectedCourse.id)
            }
          >
            <Text
              className={`text-center font-semibold ${
                isEnrolled ? 'text-amber-400' : 'text-black'
              }`}
            >
              {isEnrolled ? '\u2713 Enrolled' : 'Enroll'}
            </Text>
          </Pressable>

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

  // State A: Course List
  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <ScrollView className="flex-1 px-6 pt-4">
        <Text className="text-2xl font-bold text-white">Courses</Text>

        <View className="mt-6 gap-4 pb-8">
          {courses.map((course) => {
            const isEnrolled = enrolledCourseIds.includes(course.id);
            return (
              <CourseCard
                key={course.id}
                course={course}
                isEnrolled={isEnrolled}
                onPress={() => setSelectedCourseId(course.id)}
                onToggleEnroll={() =>
                  isEnrolled
                    ? unenrollCourse(course.id)
                    : enrollCourse(course.id)
                }
              />
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function CourseCard({
  course,
  isEnrolled,
  onPress,
  onToggleEnroll,
}: {
  course: Course;
  isEnrolled: boolean;
  onPress: () => void;
  onToggleEnroll: () => void;
}) {
  const progressPercent =
    course.totalLessons > 0
      ? (course.completedLessons / course.totalLessons) * 100
      : 0;

  const difficultyStyle = DIFFICULTY_COLORS[course.difficulty];
  const categoryStyle = CATEGORY_COLORS[course.category] ?? 'bg-neutral-800 text-neutral-400';

  return (
    <Pressable
      className={`rounded-xl border bg-neutral-900 p-6 active:bg-neutral-800 ${
        isEnrolled ? 'border-amber-500/50' : 'border-neutral-700'
      }`}
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
        {isEnrolled && (
          <View className="rounded-full bg-amber-500/20 px-3 py-1">
            <Text className="text-xs font-medium text-amber-400">{'\u2713'} Enrolled</Text>
          </View>
        )}
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
        className={`mt-3 rounded-lg px-4 py-2 ${
          isEnrolled
            ? 'border border-neutral-600 bg-neutral-800'
            : 'bg-amber-500'
        } active:opacity-80`}
        onPress={(e) => {
          e.stopPropagation?.();
          onToggleEnroll();
        }}
      >
        <Text
          className={`text-center text-sm font-semibold ${
            isEnrolled ? 'text-neutral-400' : 'text-black'
          }`}
        >
          {isEnrolled ? 'Unenroll' : 'Enroll'}
        </Text>
      </Pressable>
    </Pressable>
  );
}
