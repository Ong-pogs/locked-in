import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTokenStore } from '@/stores';

export function AlchemyScreen() {
  const navigation = useNavigation();
  const { fragments, fullTokens, dailyEarned, walletCap } = useTokenStore();

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <View className="flex-1 px-6 pt-4">
        <Pressable onPress={() => navigation.goBack()}>
          <Text className="text-neutral-400">← Back</Text>
        </Pressable>

        <Text className="mt-4 text-2xl font-bold text-white">
          Alchemy Table
        </Text>

        <View className="mt-6 rounded-xl border border-neutral-700 bg-neutral-900 p-6">
          <Text className="text-center text-3xl font-bold text-emerald-400">
            {fullTokens} M
          </Text>
          <Text className="mt-2 text-center text-neutral-400">
            Fragments: {fragments.toFixed(2)}
          </Text>
          <Text className="mt-1 text-center text-neutral-400">
            Today: {dailyEarned.toFixed(1)}/1.0 | Cap: {fullTokens}/{walletCap}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
