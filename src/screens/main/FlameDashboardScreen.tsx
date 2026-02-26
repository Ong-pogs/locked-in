import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useFlameStore, useStreakStore } from '@/stores';

export function FlameDashboardScreen() {
  const navigation = useNavigation();
  const { flameState, fuelRemaining, feedFlame } = useFlameStore();
  const { currentStreak, saverCount } = useStreakStore();

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <View className="flex-1 px-6 pt-4">
        <Pressable onPress={() => navigation.goBack()}>
          <Text className="text-neutral-400">← Back</Text>
        </Pressable>

        <Text className="mt-4 text-2xl font-bold text-white">
          Flame Dashboard
        </Text>

        <View className="mt-6 rounded-xl border border-neutral-700 bg-neutral-900 p-6">
          <Text className="text-center text-3xl font-bold text-amber-400">
            {flameState}
          </Text>
          <Text className="mt-2 text-center text-neutral-400">
            Fuel: {fuelRemaining.toFixed(1)} M tokens
          </Text>
          <Text className="mt-1 text-center text-neutral-400">
            Streak: {currentStreak} days | Savers: {saverCount}/3
          </Text>
        </View>

        <Pressable
          className="mt-4 rounded-xl bg-amber-600 px-6 py-3 active:bg-amber-700"
          onPress={() => feedFlame(1)}
        >
          <Text className="text-center font-semibold text-white">
            Feed Flame (+1 M Token)
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
