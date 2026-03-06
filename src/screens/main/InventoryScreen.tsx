import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback } from 'react';
import { useCourseStore } from '@/stores/courseStore';
import { useUserStore } from '@/stores';

function formatFuelEarnStatus(status: string): string {
  switch (status) {
    case 'PAUSED_RECOVERY':
      return 'Paused during saver recovery';
    case 'AT_CAP':
      return 'Fuel cap reached';
    case 'EARNED_TODAY':
      return 'Daily Fuel already earned';
    default:
      return 'Fuel available';
  }
}

function formatBurnTime(timestamp: string | null): string {
  if (!timestamp) {
    return 'No burn scheduled';
  }

  return new Date(timestamp).toLocaleString();
}

export function InventoryScreen() {
  const navigation = useNavigation();

  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const courseStates = useCourseStore((s) => s.courseStates);
  const refreshCourseRuntime = useCourseStore((s) => s.refreshCourseRuntime);
  const authToken = useUserStore((s) => s.authToken);

  const activeState = activeCourseId ? courseStates[activeCourseId] : null;
  const dungeonIchor = activeState?.ichorBalance ?? 0;
  const fuelBalance = activeState?.fuelCounter ?? 0;
  const fuelCap = activeState?.fuelCap ?? 7;
  const gauntletActive = activeState?.gauntletActive ?? true;
  const fuelEarnStatus = useCourseStore((s) => s.getFuelEarnStatus());
  const nextFuelBurnAt = useCourseStore((s) => s.getNextFuelBurnAt());
  const brewerStatus = gauntletActive
    ? 'Locked until gauntlet complete'
    : fuelBalance <= 0
      ? 'Stopped (Fuel is zero)'
      : 'Fuel available';

  useFocusEffect(
    useCallback(() => {
      if (activeCourseId && authToken) {
        void refreshCourseRuntime(activeCourseId, authToken).catch(() => {
          // Keep last synced runtime visible if refresh fails.
        });
      }
    }, [activeCourseId, authToken, refreshCourseRuntime]),
  );

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <View className="flex-1 px-6 pt-4">
        <Pressable onPress={() => navigation.goBack()}>
          <Text className="text-neutral-400">{'\u2190'} Back</Text>
        </Pressable>

        <Text className="mt-4 text-2xl font-bold text-white">Inventory</Text>
        <Text className="mt-1 text-sm text-neutral-500">
          Your dungeon resources
        </Text>

        {/* Fuel */}
        <View className="mt-6 rounded-xl border border-orange-500/30 bg-orange-500/5 p-5">
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-xs uppercase tracking-wide text-neutral-500">
                Fuel
              </Text>
              <Text className="mt-1 text-3xl font-bold text-orange-400">
                {fuelBalance}
                <Text className="text-base text-neutral-500">/{fuelCap}</Text>
              </Text>
            </View>
            <Text className="text-3xl">{'\u26FD'}</Text>
          </View>
          <Text className="mt-2 text-xs text-neutral-500">
            {formatFuelEarnStatus(fuelEarnStatus)}
          </Text>
          <Text className="mt-1 text-xs text-neutral-600">
            Next burn: {formatBurnTime(nextFuelBurnAt)}
          </Text>
          <Text className="mt-1 text-xs text-neutral-600">
            Brewer: {brewerStatus}
          </Text>
        </View>

        {/* Dungeon Ichor */}
        <View className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-xs uppercase tracking-wide text-neutral-500">
                Dungeon Ichor
              </Text>
              <Text className="mt-1 text-3xl font-bold text-amber-400">
                {Math.floor(dungeonIchor).toLocaleString()}
              </Text>
            </View>
            <Text className="text-3xl">{'\u2697'}</Text>
          </View>
          <Text className="mt-2 text-xs text-neutral-600">
            Locked until course complete + lock period ends
          </Text>
        </View>

      </View>
    </SafeAreaView>
  );
}
