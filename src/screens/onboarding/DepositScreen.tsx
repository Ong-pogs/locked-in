import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { OnboardingStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'Deposit'>;

export function DepositScreen() {
  const navigation = useNavigation<Nav>();

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-2xl font-bold text-white">Lock Your Funds</Text>
        <Text className="mt-2 text-center text-neutral-400">
          Deposit USDC to activate yield and begin the gauntlet
        </Text>

        <View className="mt-8 w-full rounded-xl border border-neutral-700 bg-neutral-900 p-6">
          <Text className="text-center text-3xl font-bold text-white">
            $100.00
          </Text>
          <Text className="mt-1 text-center text-sm text-neutral-400">
            USDC (mock)
          </Text>
        </View>

        <Pressable
          className="mt-6 w-full rounded-xl bg-green-600 px-6 py-4 active:bg-green-700"
          onPress={() => navigation.navigate('GauntletRoom')}
        >
          <Text className="text-center text-lg font-semibold text-white">
            Deposit & Start Gauntlet
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
