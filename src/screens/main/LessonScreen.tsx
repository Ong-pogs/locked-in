import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import * as Crypto from 'expo-crypto';
import type { MainStackParamList } from '@/navigation/types';
import { useCourseStore } from '@/stores/courseStore';
import { useStreakStore } from '@/stores/streakStore';
import { useUserStore } from '@/stores/userStore';
import type { Question } from '@/types';
import { hasRemoteLessonApi, startLesson, submitLesson } from '@/services/api';
import { refreshAuthSession } from '@/services/api/auth/authApi';
import { ApiError } from '@/services/api/errors';
import { getLessonReadableContent } from '@/utils/lessonContent';

type Nav = NativeStackNavigationProp<MainStackParamList, 'Lesson'>;
type Route = RouteProp<MainStackParamList, 'Lesson'>;
type Phase = 'reading' | 'questions';

export function LessonScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { lessonId, courseId } = route.params;

  const lesson = useCourseStore((s) => s.getLesson(lessonId));
  const lessons = useCourseStore((s) => s.getLessonsForCourse(courseId));
  const walletAddress = useUserStore((s) => s.walletAddress);
  const authToken = useUserStore((s) => s.authToken);
  const refreshToken = useUserStore((s) => s.refreshToken);
  const setAuthSession = useUserStore((s) => s.setAuthSession);

  const [phase, setPhase] = useState<Phase>('reading');
  const [startSynced, setStartSynced] = useState(false);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [attemptStartedAt, setAttemptStartedAt] = useState<string | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [textAnswer, setTextAnswer] = useState('');
  const [submittedAnswers, setSubmittedAnswers] = useState<Record<string, string>>({});
  const [hasChecked, setHasChecked] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const questions = lesson?.questions ?? [];
  const currentQuestion: Question | undefined = questions[currentQuestionIndex];
  const totalQuestions = questions.length;
  const isLastQuestion = currentQuestionIndex === totalQuestions - 1;
  const lessonOrder = lesson?.order ?? 0;
  const totalLessonsInCourse = lessons.length;
  const usesRemoteVerification =
    hasRemoteLessonApi() &&
    lesson?.releaseId !== 'local-mock-release' &&
    !!walletAddress;
  const supportsLocalChecking = Boolean(currentQuestion?.correctAnswer);
  const canContinue =
    (currentQuestion?.type === 'mcq' && Boolean(selectedOption)) ||
    (currentQuestion?.type === 'short_text' && textAnswer.trim().length > 0);

  const refreshBackendAccessToken = useCallback(async (): Promise<string | null> => {
    if (!refreshToken) {
      return null;
    }

    try {
      const refreshed = await refreshAuthSession({ refreshToken });
      setAuthSession(refreshed.accessToken, refreshed.refreshToken);
      return refreshed.accessToken;
    } catch (error) {
      if (__DEV__) {
        console.warn('[lesson-api] refresh session failed, forcing reconnect:', error);
      }
      setAuthSession(null, null);
      return null;
    }
  }, [refreshToken, setAuthSession]);

  const ensureBackendAccessToken = useCallback(async (): Promise<string | null> => {
    if (!usesRemoteVerification) {
      return null;
    }

    if (authToken) {
      return authToken;
    }

    return refreshBackendAccessToken();
  }, [usesRemoteVerification, authToken, refreshBackendAccessToken]);

  const runWithTokenRefreshRetry = useCallback(
    async <T,>(operation: (token: string) => Promise<T>): Promise<T | null> => {
      const token = await ensureBackendAccessToken();
      if (!token) {
        return null;
      }

      try {
        return await operation(token);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) {
          throw error;
        }

        const refreshedToken = await refreshBackendAccessToken();
        if (!refreshedToken) {
          return null;
        }

        return operation(refreshedToken);
      }
    },
    [ensureBackendAccessToken, refreshBackendAccessToken],
  );

  const applyLessonCompletion = useCallback(
    (score: number) => {
      useCourseStore.getState().completeLesson(lessonId, courseId, score);
      useStreakStore.getState().completeDay();
    },
    [courseId, lessonId],
  );

  const syncLessonStart = useCallback(
    (nextAttemptId: string, startedAt: string) => {
      if (startSynced || !usesRemoteVerification) {
        return;
      }

      setStartSynced(true);

      runWithTokenRefreshRetry((token) =>
        startLesson(
          lessonId,
          {
            attemptId: nextAttemptId,
            startedAt,
          },
          token,
        ),
      ).catch((error) => {
        setStartSynced(false);
        if (__DEV__) {
          console.warn('[lesson-api] start lesson sync failed:', error);
        }
      });
    },
    [lessonId, runWithTokenRefreshRetry, startSynced, usesRemoteVerification],
  );

  const gradeCurrentAnswer = useCallback(() => {
    if (!currentQuestion?.correctAnswer) {
      return false;
    }

    if (currentQuestion.type === 'mcq') {
      return selectedOption === currentQuestion.correctAnswer;
    }

    return (
      textAnswer.trim().replace(/\s+/g, ' ').toLowerCase() ===
      currentQuestion.correctAnswer.trim().replace(/\s+/g, ' ').toLowerCase()
    );
  }, [currentQuestion, selectedOption, textAnswer]);

  const buildAnswerMapWithCurrent = useCallback(() => {
    if (!currentQuestion) {
      return submittedAnswers;
    }

    const answerText =
      currentQuestion.type === 'mcq' ? selectedOption ?? '' : textAnswer.trim();

    return {
      ...submittedAnswers,
      [currentQuestion.id]: answerText,
    };
  }, [currentQuestion, selectedOption, submittedAnswers, textAnswer]);

  const submitRemoteLesson = useCallback(
    async (answerMap: Record<string, string>) => {
      if (!attemptId || !attemptStartedAt) {
        throw new Error('Lesson attempt was not initialized.');
      }

      const response = await runWithTokenRefreshRetry((token) =>
        submitLesson(
          lessonId,
          {
            attemptId,
            startedAt: attemptStartedAt,
            completedAt: new Date().toISOString(),
            answers: questions.map((question) => ({
              questionId: question.id,
              answerText: answerMap[question.id] ?? '',
            })),
          },
          token,
        ),
      );

      if (!response) {
        throw new Error('Backend session expired.');
      }

      return response;
    },
    [attemptId, attemptStartedAt, lessonId, questions, runWithTokenRefreshRetry],
  );

  const finalizeLesson = useCallback(
    async (answerMap: Record<string, string>) => {
      if (usesRemoteVerification) {
        setSubmitting(true);
        try {
          const result = await submitRemoteLesson(answerMap);
          if (result.courseRuntime) {
            useCourseStore
              .getState()
              .syncCourseRuntime(courseId, result.courseRuntime);
          }
          applyLessonCompletion(result.score);
          navigation.navigate('LessonResult', {
            lessonId,
            courseId,
            score: result.score,
            totalQuestions: result.totalQuestions,
          });
        } catch (error) {
          if (__DEV__) {
            console.warn('[lesson-api] submit lesson failed:', error);
          }
          Alert.alert(
            'Submit Failed',
            'The backend could not verify this lesson yet. Please try again.',
          );
        } finally {
          setSubmitting(false);
        }
        return;
      }

      const score = Math.round((correctCount / Math.max(totalQuestions, 1)) * 100);
      applyLessonCompletion(score);
      navigation.navigate('LessonResult', {
        lessonId,
        courseId,
        score,
        totalQuestions,
      });
    },
    [
      applyLessonCompletion,
      correctCount,
      courseId,
      lessonId,
      navigation,
      submitRemoteLesson,
      totalQuestions,
      usesRemoteVerification,
    ],
  );

  const handleCheck = useCallback(() => {
    if (!currentQuestion || !supportsLocalChecking) {
      return;
    }

    const correct = gradeCurrentAnswer();
    setIsCorrect(correct);
    setHasChecked(true);
    if (correct) {
      setCorrectCount((count) => count + 1);
    }
  }, [currentQuestion, gradeCurrentAnswer, supportsLocalChecking]);

  const handleAdvance = useCallback(async () => {
    if (!currentQuestion) {
      return;
    }

    const nextAnswers = buildAnswerMapWithCurrent();
    setSubmittedAnswers(nextAnswers);

    if (isLastQuestion) {
      await finalizeLesson(nextAnswers);
      return;
    }

    setCurrentQuestionIndex((index) => index + 1);
    setSelectedOption(null);
    setTextAnswer('');
    setHasChecked(false);
    setIsCorrect(false);
  }, [buildAnswerMapWithCurrent, currentQuestion, finalizeLesson, isLastQuestion]);

  const handleStartQuestions = useCallback(() => {
    const nextAttemptId = Crypto.randomUUID();
    const startedAt = new Date().toISOString();

    setAttemptId(nextAttemptId);
    setAttemptStartedAt(startedAt);
    setPhase('questions');
    syncLessonStart(nextAttemptId, startedAt);
  }, [syncLessonStart]);

  if (!lesson) {
    return (
      <SafeAreaView className="flex-1 bg-neutral-950">
        <View className="flex-1 items-center justify-center">
          <Text className="text-neutral-400">Lesson not found</Text>
        </View>
      </SafeAreaView>
    );
  }

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

          <Text className="mt-3 text-2xl font-bold text-white">{lesson.title}</Text>

          <Text className="mt-4 text-base leading-6 text-neutral-300">
            {getLessonReadableContent(lesson)}
          </Text>

          <Pressable
            className="mb-8 mt-8 rounded-xl bg-amber-600 px-6 py-4 active:bg-amber-700"
            onPress={handleStartQuestions}
          >
            <Text className="text-center text-lg font-semibold text-white">
              Start Questions
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <ScrollView className="flex-1 px-6 pt-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-neutral-400">
            Question {currentQuestionIndex + 1} of {totalQuestions}
          </Text>
          {usesRemoteVerification && (
            <Text className="text-xs text-neutral-500">Scored on submit</Text>
          )}
        </View>

        <View className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-800">
          <View
            className="h-full rounded-full bg-amber-500"
            style={{
              width: `${((currentQuestionIndex + 1) / Math.max(totalQuestions, 1)) * 100}%`,
            }}
          />
        </View>

        <Text className="mt-6 text-lg font-semibold text-white">
          {currentQuestion?.prompt}
        </Text>

        {currentQuestion?.type === 'mcq' && (
          <View className="mt-4 gap-3">
            {currentQuestion.options?.map((option) => {
              const optionId = typeof option === 'string' ? option : option.id;
              const optionText = typeof option === 'string' ? option : option.text;
              let borderColor = 'border-neutral-700';
              let bgColor = 'bg-neutral-900';

              if (supportsLocalChecking && hasChecked && currentQuestion.correctAnswer) {
                if (optionText === currentQuestion.correctAnswer) {
                  borderColor = 'border-green-500';
                  bgColor = 'bg-green-950';
                } else if (
                  optionText === selectedOption &&
                  optionText !== currentQuestion.correctAnswer
                ) {
                  borderColor = 'border-red-500';
                  bgColor = 'bg-red-950';
                }
              } else if (optionText === selectedOption) {
                borderColor = 'border-amber-500';
                bgColor = 'bg-neutral-800';
              }

              return (
                <Pressable
                  key={optionId}
                  className={`rounded-xl border p-4 ${borderColor} ${bgColor}`}
                  onPress={() => {
                    if (!hasChecked || !supportsLocalChecking) {
                      setSelectedOption(optionText);
                    }
                  }}
                  disabled={supportsLocalChecking && hasChecked}
                >
                  <Text className="text-base text-white">{optionText}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {currentQuestion?.type === 'short_text' && (
          <View className="mt-4">
            <TextInput
              className={`rounded-xl border p-4 text-white ${
                supportsLocalChecking && hasChecked
                  ? isCorrect
                    ? 'border-green-500 bg-green-950'
                    : 'border-red-500 bg-red-950'
                  : 'border-neutral-700 bg-neutral-900'
              }`}
              placeholderTextColor="#737373"
              placeholder="Type your answer..."
              value={textAnswer}
              onChangeText={(value) => {
                if (!hasChecked || !supportsLocalChecking) {
                  setTextAnswer(value);
                }
              }}
              editable={!supportsLocalChecking || !hasChecked}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {supportsLocalChecking && hasChecked && !isCorrect && currentQuestion.correctAnswer && (
              <Text className="mt-2 text-sm text-neutral-400">
                Correct answer:{' '}
                <Text className="font-semibold text-green-400">
                  {currentQuestion.correctAnswer}
                </Text>
              </Text>
            )}
          </View>
        )}

        {supportsLocalChecking && hasChecked && (
          <Text
            className={`mt-4 text-base font-semibold ${
              isCorrect ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {isCorrect ? 'Correct!' : 'Incorrect'}
          </Text>
        )}

        {usesRemoteVerification && (
          <Text className="mt-4 text-sm text-neutral-500">
            Answers are verified by the lesson API after you finish the lesson.
          </Text>
        )}

        <View className="mb-8 mt-6">
          {supportsLocalChecking && !hasChecked ? (
            <Pressable
              className={`rounded-xl px-6 py-4 ${
                canContinue ? 'bg-amber-600 active:bg-amber-700' : 'bg-neutral-800'
              }`}
              onPress={handleCheck}
              disabled={!canContinue}
            >
              <Text
                className={`text-center text-lg font-semibold ${
                  canContinue ? 'text-white' : 'text-neutral-600'
                }`}
              >
                {currentQuestion?.type === 'mcq' ? 'Check Answer' : 'Submit'}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              className={`rounded-xl px-6 py-4 ${
                canContinue || (supportsLocalChecking && hasChecked)
                  ? 'bg-amber-600 active:bg-amber-700'
                  : 'bg-neutral-800'
              }`}
              onPress={() => {
                void handleAdvance();
              }}
              disabled={submitting || (!supportsLocalChecking && !canContinue)}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-center text-lg font-semibold text-white">
                  {isLastQuestion ? 'See Results' : 'Next Question'}
                </Text>
              )}
            </Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
