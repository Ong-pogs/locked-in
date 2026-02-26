import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

export function LeaderboardScreen() {
  const navigation = useNavigation();

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <View className="flex-1 px-6 pt-4">
        <Pressable onPress={() => navigation.goBack()}>
          <Text className="text-neutral-400">← Back</Text>
        </Pressable>
        <Text className="mt-4 text-2xl font-bold text-white">
          Leaderboard
        </Text>
        <Text className="mt-2 text-neutral-500">
          Notice Board — rankings coming soon
        </Text>
      </View>
    </SafeAreaView>
  );
}
