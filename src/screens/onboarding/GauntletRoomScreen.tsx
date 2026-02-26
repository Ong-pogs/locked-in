import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useUserStore } from '@/stores';

export function GauntletRoomScreen() {
  const completeGauntlet = useUserStore((s) => s.completeGauntlet);

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-2xl font-bold text-amber-400">
          Week 1 Gauntlet
        </Text>
        <Text className="mt-2 text-center text-neutral-400">
          No savers. No yield. Maximum stakes. Complete 7 days to unlock the
          dungeon.
        </Text>

        <Pressable
          className="mt-8 w-full rounded-xl bg-amber-600 px-6 py-4 active:bg-amber-700"
          onPress={completeGauntlet}
        >
          <Text className="text-center text-lg font-semibold text-white">
            Skip Gauntlet (Dev)
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
