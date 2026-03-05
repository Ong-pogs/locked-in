import { useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { MainStackParamList } from '@/navigation/types';
import { useCourseStore } from '@/stores/courseStore';
import { useStreakStore } from '@/stores/streakStore';
import { useTokenStore } from '@/stores/tokenStore';
import { useUserStore } from '@/stores/userStore';
import type { Question } from '@/types';
import { getLessonReadableContent } from '@/utils/lessonContent';
import { hasRemoteLessonApi, submitLesson } from '@/services/api';

type Nav = NativeStackNavigationProp<MainStackParamList, 'Lesson'>;
type Route = RouteProp<MainStackParamList, 'Lesson'>;

type Phase = 'reading' | 'questions';

export function LessonScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { lessonId, courseId } = route.params;

  const lesson = useCourseStore((s) => s.getLesson(lessonId));
  const lessons = useCourseStore((s) => s.getLessonsForCourse(courseId));
  const authToken = useUserStore((s) => s.authToken);

  const [phase, setPhase] = useState<Phase>('reading');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [textAnswer, setTextAnswer] = useState('');
  const [hasChecked, setHasChecked] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);

  const questions = lesson?.questions ?? [];
  const currentQuestion: Question | undefined = questions[currentQuestionIndex];
  const totalQuestions = questions.length;
  const isLastQuestion = currentQuestionIndex === totalQuestions - 1;
  const lessonOrder = lesson?.order ?? 0;
  const totalLessonsInCourse = lessons.length;

  const handleCheck = useCallback(() => {
    if (!currentQuestion) return;

    let correct = false;
    if (currentQuestion.type === 'mcq') {
      correct = selectedOption === currentQuestion.correctAnswer;
    } else {
      correct = textAnswer
        .trim()
        .toLowerCase()
        .includes(currentQuestion.correctAnswer.toLowerCase());
    }

    setIsCorrect(correct);
    setHasChecked(true);
    if (correct) setCorrectCount((c) => c + 1);
  }, [currentQuestion, selectedOption, textAnswer]);

  const handleNext = useCallback(() => {
    if (isLastQuestion) {
      // Calculate final score
      const finalCorrect = correctCount;
      const score = Math.round((finalCorrect / totalQuestions) * 100);
      const fragmentReward = score >= 80 ? 0.3 : score >= 50 ? 0.2 : 0.1;

      // Update stores
      useCourseStore.getState().completeLesson(lessonId, courseId, score);
      useStreakStore.getState().completeDay();
      useTokenStore.getState().awardFragment(fragmentReward, 'lesson');

      if (hasRemoteLessonApi() && authToken) {
        submitLesson(
          lessonId,
          {
            score,
            totalQuestions,
            completedAt: new Date().toISOString(),
          },
          authToken,
        ).catch(() => {
          // Local progress is source-of-truth until backend sync is fully enforced.
        });
      }

      navigation.navigate('LessonResult', {
        lessonId,
        courseId,
        score,
        totalQuestions,
      });
    } else {
      setCurrentQuestionIndex((i) => i + 1);
      setSelectedOption(null);
      setTextAnswer('');
      setHasChecked(false);
      setIsCorrect(false);
    }
  }, [
    isLastQuestion,
    correctCount,
    totalQuestions,
    lessonId,
    courseId,
    authToken,
    navigation,
  ]);

  if (!lesson) {
    return (
      <SafeAreaView className="flex-1 bg-neutral-950">
        <View className="flex-1 items-center justify-center">
          <Text className="text-neutral-400">Lesson not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Reading phase
  if (phase === 'reading') {
    return (
      <SafeAreaView className="flex-1 bg-neutral-950">
        <ScrollView className="flex-1 px-6 pt-4">
          <Pressable onPress={() => navigation.goBack()}>
            <Text className="text-neutral-400">{'\u2190'} Back</Text>
          </Pressable>

          <Text className="mt-1 text-sm text-neutral-500">
            Lesson {lessonOrder} of {totalLessonsInCourse}
          </Text>

          <Text className="mt-3 text-2xl font-bold text-white">
            {lesson.title}
          </Text>

          <Text className="mt-4 text-base leading-6 text-neutral-300">
            {getLessonReadableContent(lesson)}
          </Text>

          <Pressable
            className="mb-8 mt-8 rounded-xl bg-amber-600 px-6 py-4 active:bg-amber-700"
            onPress={() => setPhase('questions')}
          >
            <Text className="text-center text-lg font-semibold text-white">
              Start Questions
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Questions phase
  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <ScrollView className="flex-1 px-6 pt-4">
        {/* Progress bar */}
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-neutral-400">
            Question {currentQuestionIndex + 1} of {totalQuestions}
          </Text>
        </View>
        <View className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-800">
          <View
            className="h-full rounded-full bg-amber-500"
            style={{
              width: `${((currentQuestionIndex + 1) / totalQuestions) * 100}%`,
            }}
          />
        </View>

        {/* Question prompt */}
        <Text className="mt-6 text-lg font-semibold text-white">
          {currentQuestion?.prompt}
        </Text>

        {/* MCQ rendering */}
        {currentQuestion?.type === 'mcq' && (
          <View className="mt-4 gap-3">
            {currentQuestion.options?.map((option) => {
              let borderColor = 'border-neutral-700';
              let bgColor = 'bg-neutral-900';

              if (hasChecked) {
                if (option === currentQuestion.correctAnswer) {
                  borderColor = 'border-green-500';
                  bgColor = 'bg-green-950';
                } else if (
                  option === selectedOption &&
                  option !== currentQuestion.correctAnswer
                ) {
                  borderColor = 'border-red-500';
                  bgColor = 'bg-red-950';
                }
              } else if (option === selectedOption) {
                borderColor = 'border-amber-500';
                bgColor = 'bg-neutral-800';
              }

              return (
                <Pressable
                  key={option}
                  className={`rounded-xl border p-4 ${borderColor} ${bgColor}`}
                  onPress={() => {
                    if (!hasChecked) setSelectedOption(option);
                  }}
                  disabled={hasChecked}
                >
                  <Text className="text-base text-white">{option}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Short text rendering */}
        {currentQuestion?.type === 'short_text' && (
          <View className="mt-4">
            <TextInput
              className={`rounded-xl border p-4 text-white ${
                hasChecked
                  ? isCorrect
                    ? 'border-green-500 bg-green-950'
                    : 'border-red-500 bg-red-950'
                  : 'border-neutral-700 bg-neutral-900'
              }`}
              placeholderTextColor="#737373"
              placeholder="Type your answer..."
              value={textAnswer}
              onChangeText={(t) => {
                if (!hasChecked) setTextAnswer(t);
              }}
              editable={!hasChecked}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {hasChecked && !isCorrect && (
              <Text className="mt-2 text-sm text-neutral-400">
                Correct answer:{' '}
                <Text className="font-semibold text-green-400">
                  {currentQuestion.correctAnswer}
                </Text>
              </Text>
            )}
          </View>
        )}

        {/* Feedback text */}
        {hasChecked && (
          <Text
            className={`mt-4 text-base font-semibold ${
              isCorrect ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {isCorrect ? 'Correct!' : 'Incorrect'}
          </Text>
        )}

        {/* Action button */}
        <View className="mb-8 mt-6">
          {!hasChecked ? (
            <Pressable
              className={`rounded-xl px-6 py-4 ${
                (currentQuestion?.type === 'mcq' && selectedOption) ||
                (currentQuestion?.type === 'short_text' && textAnswer.trim())
                  ? 'bg-amber-600 active:bg-amber-700'
                  : 'bg-neutral-800'
              }`}
              onPress={handleCheck}
              disabled={
                (currentQuestion?.type === 'mcq' && !selectedOption) ||
                (currentQuestion?.type === 'short_text' && !textAnswer.trim())
              }
            >
              <Text
                className={`text-center text-lg font-semibold ${
                  (currentQuestion?.type === 'mcq' && selectedOption) ||
                  (currentQuestion?.type === 'short_text' && textAnswer.trim())
                    ? 'text-white'
                    : 'text-neutral-600'
                }`}
              >
                {currentQuestion?.type === 'mcq' ? 'Check Answer' : 'Submit'}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              className="rounded-xl bg-amber-600 px-6 py-4 active:bg-amber-700"
              onPress={handleNext}
            >
              <Text className="text-center text-lg font-semibold text-white">
                {isLastQuestion ? 'See Results' : 'Next Question'}
              </Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
