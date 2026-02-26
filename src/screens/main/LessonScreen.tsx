import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { MainStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList, 'Lesson'>;
type Route = RouteProp<MainStackParamList, 'Lesson'>;

export function LessonScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { lessonId, courseId } = route.params;

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <View className="flex-1 px-6 pt-4">
        <Pressable onPress={() => navigation.goBack()}>
          <Text className="text-neutral-400">← Back</Text>
        </Pressable>
        <Text className="mt-4 text-2xl font-bold text-white">Lesson</Text>
        <Text className="mt-2 text-neutral-500">
          Course: {courseId} | Lesson: {lessonId}
        </Text>

        <Pressable
          className="mt-8 rounded-xl bg-green-600 px-6 py-4 active:bg-green-700"
          onPress={() => navigation.navigate('LessonResult', { lessonId, score: 85 })}
        >
          <Text className="text-center text-lg font-semibold text-white">
            Complete Lesson
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
