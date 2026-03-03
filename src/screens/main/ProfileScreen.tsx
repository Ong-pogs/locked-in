import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useUserStore, useYieldStore } from '@/stores';

export function ProfileScreen() {
  const { walletAddress, disconnect } = useUserStore();
  const { lockedAmount, totalAccrued, apy } = useYieldStore();

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <View className="flex-1 px-6 pt-4">
        <Text className="text-2xl font-bold text-white">Profile</Text>

        <View className="mt-6 rounded-xl border border-neutral-700 bg-neutral-900 p-6">
          <Text className="text-sm text-neutral-400">Wallet</Text>
          <Text className="mt-1 text-white">
            {walletAddress
              ? `${walletAddress.slice(0, 8)}...${walletAddress.slice(-4)}`
              : 'Not connected'}
          </Text>

          <Text className="mt-4 text-sm text-neutral-400">Locked</Text>
          <Text className="mt-1 text-white">
            ${lockedAmount.toFixed(2)} USDC @ {apy}% APY
          </Text>

          <Text className="mt-4 text-sm text-neutral-400">Yield Earned</Text>
          <Text className="mt-1 text-emerald-400">
            +${totalAccrued.toFixed(4)}
          </Text>
        </View>

        <Pressable
          className="mt-6 rounded-xl bg-red-600 px-6 py-3 active:bg-red-700"
          onPress={disconnect}
        >
          <Text className="text-center font-semibold text-white">
            Disconnect Wallet
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
