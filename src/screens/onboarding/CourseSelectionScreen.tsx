import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { OnboardingStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'CourseSelection'>;

export function CourseSelectionScreen() {
  const navigation = useNavigation<Nav>();

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-2xl font-bold text-white">Choose Your Path</Text>
        <Text className="mt-2 text-center text-neutral-400">
          Select a course to begin the gauntlet
        </Text>

        <Pressable
          className="mt-8 w-full rounded-xl border border-neutral-700 bg-neutral-900 p-4 active:bg-neutral-800"
          onPress={() => navigation.navigate('Deposit')}
        >
          <Text className="text-lg font-semibold text-white">
            Solana Development
          </Text>
          <Text className="mt-1 text-sm text-neutral-400">
            Build on Solana from scratch
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
