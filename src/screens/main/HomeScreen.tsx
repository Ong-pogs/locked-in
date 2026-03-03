import { View, Text, Pressable, FlatList, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MainStackParamList } from '@/navigation/types';
import { useStreakStore, useYieldStore, useFlameStore, useBrewStore } from '@/stores';
import { useCourseStore } from '@/stores/courseStore';
import type { Course } from '@/types';

type Nav = NativeStackNavigationProp<MainStackParamList>;

export function HomeScreen() {
  const navigation = useNavigation<Nav>();

  // Initialize mock data
  useCourseStore.getState().initializeMockData();

  // Store data
  const dayNumber = useStreakStore((s) => s.dayNumber);
  const currentStreak = useStreakStore((s) => s.currentStreak);
  const saverCount = useStreakStore((s) => s.saverCount);
  const flameState = useFlameStore((s) => s.flameState);
  const totalAccrued = useYieldStore((s) => s.totalAccrued);
  const ichorBalance = useBrewStore((s) => s.ichorBalance);
  const enrolledCourses = useCourseStore((s) => s.getEnrolledCourses());
  const lessons = useCourseStore((s) => s.lessons);
  const lessonProgress = useCourseStore((s) => s.lessonProgress);

  const flameIcon = flameState === 'COLD' ? '\u2740' : '\u2739'; // ❀ vs ✹

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <ScrollView className="flex-1 px-5 pt-4" showsVerticalScrollIndicator={false}>
        {/* Top bar */}
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <Text className="text-lg">{flameIcon}</Text>
            <Text className="text-lg font-bold text-white">Day {dayNumber}</Text>
          </View>
          <View className="flex-row items-center gap-2">
            <Text className="text-lg">{'\u2697'}</Text>
            <Text className="text-lg font-bold text-amber-400">
              {Math.floor(ichorBalance).toLocaleString()}
            </Text>
          </View>
        </View>

        {/* Dungeon preview card */}
        <View className="mt-5 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <View className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-purple-900/20" />
          <View className="absolute -bottom-6 -left-6 h-32 w-32 rounded-full bg-amber-900/10" />
          <Text className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
            {'\u2694'} The Underground
          </Text>
          <Text className="mt-2 text-xl font-bold text-white">
            The dungeon awaits...
          </Text>
          <Text className="mt-1 text-sm text-neutral-500">
            Tap objects to learn, brew, and track your flame.
          </Text>
        </View>

        {/* Stats grid */}
        <View className="mt-5 flex-row gap-3">
          <View className="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
            <Text className="text-xs text-neutral-500">Yield</Text>
            <Text className="mt-1 text-lg font-bold text-emerald-400">
              ${totalAccrued.toFixed(2)}
            </Text>
          </View>
          <View className="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
            <Text className="text-xs text-neutral-500">Streak</Text>
            <Text className="mt-1 text-lg font-bold text-white">
              {currentStreak} days
            </Text>
          </View>
        </View>
        <View className="mt-3 flex-row gap-3">
          <View className="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
            <Text className="text-xs text-neutral-500">Ichor</Text>
            <Text className="mt-1 text-lg font-bold text-amber-400">
              {Math.floor(ichorBalance).toLocaleString()}
            </Text>
          </View>
          <View className="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
            <Text className="text-xs text-neutral-500">Savers</Text>
            <Text className="mt-1 text-lg font-bold text-white">
              {saverCount}/3
            </Text>
          </View>
        </View>

        {/* Active courses */}
        <View className="mt-6">
          <Text className="text-lg font-bold text-white">Your Courses</Text>
          {enrolledCourses.length === 0 ? (
            <View className="mt-3 items-center rounded-xl border border-dashed border-neutral-700 bg-neutral-900/50 p-8">
              <Text className="text-neutral-500">No courses yet</Text>
              <Pressable
                className="mt-3 rounded-lg bg-neutral-800 px-5 py-2 active:bg-neutral-700"
                onPress={() =>
                  navigation.navigate('MainTabs', { screen: 'Courses' })
                }
              >
                <Text className="font-semibold text-amber-400">
                  Browse Catalog
                </Text>
              </Pressable>
            </View>
          ) : (
            <FlatList
              horizontal
              data={enrolledCourses}
              keyExtractor={(c) => c.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 12, paddingVertical: 12 }}
              renderItem={({ item }) => (
                <EnrolledCourseCard
                  course={item}
                  lessons={lessons}
                  lessonProgress={lessonProgress}
                  onPress={() => {
                    const courseLessons = (lessons[item.id] ?? []).sort(
                      (a, b) => a.order - b.order,
                    );
                    const next = courseLessons.find(
                      (l) => !lessonProgress[l.id]?.completed,
                    );
                    if (next) {
                      navigation.navigate('Lesson', {
                        lessonId: next.id,
                        courseId: item.id,
                      });
                    } else {
                      navigation.navigate('MainTabs', { screen: 'Courses' });
                    }
                  }}
                />
              )}
            />
          )}
        </View>

        {/* Enter Dungeon CTA */}
        <Pressable
          className="mb-8 mt-6 overflow-hidden rounded-2xl bg-purple-700 p-5 active:bg-purple-800"
          onPress={() =>
            navigation.navigate('MainTabs', { screen: 'Dungeon' })
          }
        >
          <View className="absolute -right-3 -top-3 h-20 w-20 rounded-full bg-amber-500/15" />
          <Text className="text-center text-lg font-bold text-white">
            {'\u2694'} ENTER DUNGEON
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

// -- Enrolled course card for horizontal list --
function EnrolledCourseCard({
  course,
  lessons,
  lessonProgress,
  onPress,
}: {
  course: Course;
  lessons: Record<string, any[]>;
  lessonProgress: Record<string, any>;
  onPress: () => void;
}) {
  const courseLessons = (lessons[course.id] ?? []).sort(
    (a: any, b: any) => a.order - b.order,
  );
  const completedCount = courseLessons.filter(
    (l: any) => lessonProgress[l.id]?.completed,
  ).length;
  const nextLesson = courseLessons.find(
    (l: any) => !lessonProgress[l.id]?.completed,
  );
  const progress =
    course.totalLessons > 0 ? (completedCount / course.totalLessons) * 100 : 0;

  const CATEGORY_COLORS: Record<string, string> = {
    solana: 'bg-purple-900 text-purple-400',
    web3: 'bg-blue-900 text-blue-400',
    defi: 'bg-emerald-900 text-emerald-400',
    security: 'bg-red-900 text-red-400',
    rust: 'bg-orange-900 text-orange-400',
  };
  const catStyle = CATEGORY_COLORS[course.category] ?? 'bg-neutral-800 text-neutral-400';

  return (
    <Pressable
      className="w-56 rounded-xl border border-neutral-700 bg-neutral-900 p-4 active:bg-neutral-800"
      onPress={onPress}
    >
      {/* Category pill */}
      <View className={`self-start rounded-full px-2.5 py-0.5 ${catStyle.split(' ')[0]}`}>
        <Text className={`text-xs font-medium ${catStyle.split(' ')[1]}`}>
          {course.category}
        </Text>
      </View>

      <Text className="mt-2 text-base font-bold text-white" numberOfLines={1}>
        {course.title}
      </Text>

      {/* Progress bar */}
      <View className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-800">
        <View
          className="h-full rounded-full bg-amber-500"
          style={{ width: `${progress}%` }}
        />
      </View>
      <Text className="mt-1 text-xs text-neutral-500">
        {completedCount}/{course.totalLessons} lessons
      </Text>

      {/* Next lesson */}
      {nextLesson && (
        <Text className="mt-2 text-xs text-neutral-400" numberOfLines={1}>
          Next: {nextLesson.title}
        </Text>
      )}
    </Pressable>
  );
}
