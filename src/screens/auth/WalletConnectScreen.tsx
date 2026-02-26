import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useUserStore } from '@/stores';

export function WalletConnectScreen() {
  const setWallet = useUserStore((s) => s.setWallet);

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-4xl font-bold text-white">Locked In</Text>
        <Text className="mt-3 text-center text-base text-neutral-400">
          Lock your funds. Light the flame. Learn or burn.
        </Text>

        <Pressable
          className="mt-12 w-full rounded-xl bg-purple-600 px-6 py-4 active:bg-purple-700"
          onPress={() => setWallet('MOCK_WALLET_ADDRESS')}
        >
          <Text className="text-center text-lg font-semibold text-white">
            Connect Wallet
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
