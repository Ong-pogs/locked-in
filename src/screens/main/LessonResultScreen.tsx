import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { MainStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList, 'LessonResult'>;
type Route = RouteProp<MainStackParamList, 'LessonResult'>;

export function LessonResultScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { score } = route.params;

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-4xl font-bold text-white">{score}%</Text>
        <Text className="mt-2 text-neutral-400">Lesson Complete</Text>

        <Pressable
          className="mt-8 w-full rounded-xl bg-purple-600 px-6 py-4 active:bg-purple-700"
          onPress={() => navigation.navigate('UndergroundHub')}
        >
          <Text className="text-center text-lg font-semibold text-white">
            Return to Hub
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
