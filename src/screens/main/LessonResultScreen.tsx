import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { MainStackParamList } from '@/navigation/types';
import { useStreakStore } from '@/stores/streakStore';

type Nav = NativeStackNavigationProp<MainStackParamList, 'LessonResult'>;
type Route = RouteProp<MainStackParamList, 'LessonResult'>;

export function LessonResultScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { score, totalQuestions } = route.params;

  const currentStreak = useStreakStore((s) => s.currentStreak);

  const correctCount = Math.round((score / 100) * totalQuestions);
  const fragmentReward = score >= 80 ? 0.3 : score >= 50 ? 0.2 : 0.1;

  const scoreColor =
    score >= 80
      ? 'text-green-400'
      : score >= 50
        ? 'text-amber-400'
        : 'text-red-400';

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <View className="flex-1 items-center justify-center px-8">
        {/* Score */}
        <Text className={`text-6xl font-bold ${scoreColor}`}>{score}%</Text>
        <Text className="mt-2 text-lg text-neutral-400">
          {correctCount}/{totalQuestions} Questions Correct
        </Text>

        {/* Reward cards */}
        <View className="mt-8 w-full gap-4">
          {/* Fragment reward */}
          <View className="rounded-xl border border-neutral-700 bg-neutral-900 p-5">
            <Text className="text-sm text-neutral-500">Fragment Earned</Text>
            <Text className="mt-1 text-2xl font-bold text-emerald-400">
              +{fragmentReward} M
            </Text>
          </View>

          {/* Streak status */}
          <View className="rounded-xl border border-neutral-700 bg-neutral-900 p-5">
            <Text className="text-sm text-neutral-500">Current Streak</Text>
            <Text className="mt-1 text-2xl font-bold text-amber-400">
              {currentStreak} day{currentStreak !== 1 ? 's' : ''}
            </Text>
          </View>
        </View>

        {/* Return button */}
        <Pressable
          className="mt-8 w-full rounded-xl bg-purple-600 px-6 py-4 active:bg-purple-700"
          onPress={() => navigation.navigate('MainTabs', { screen: 'Home' })}
        >
          <Text className="text-center text-lg font-semibold text-white">
            Return to Hub
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
