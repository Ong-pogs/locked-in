import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import * as Crypto from 'expo-crypto';
import type { MainStackParamList } from '@/navigation/types';
import { useCourseStore } from '@/stores/courseStore';
import { useFlameStore } from '@/stores/flameStore';
import { useStreakStore } from '@/stores/streakStore';
import { useUserStore } from '@/stores/userStore';
import type { Question } from '@/types';
import { hasRemoteLessonApi, startLesson, submitLesson } from '@/services/api';
import { refreshAuthSession } from '@/services/api/auth/authApi';
import { ApiError } from '@/services/api/errors';
import { getLessonReadableContent } from '@/utils/lessonContent';
import {
  ScreenBackground,
  BackButton,
  ParchmentCard,
  T,
  ts,
} from '@/theme';

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
      // Sync flame brightness with the new streak count
      const newStreak = useStreakStore.getState().currentStreak;
      useFlameStore.getState().updateFromStreak(newStreak);
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
          if (result.accepted) {
            applyLessonCompletion(result.score);
          }
          navigation.navigate('LessonResult', {
            lessonId,
            courseId,
            score: result.score,
            totalQuestions: result.totalQuestions,
            accepted: result.accepted,
            questionResults: result.questionResults?.map((question) => ({
              questionId: question.questionId,
              prompt: question.prompt,
              accepted: question.accepted,
              score: question.score,
              feedbackSummary: question.feedbackSummary,
            })),
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
      <ScreenBackground>
        <View style={s.centered}>
          <Text style={s.notFoundText}>Lesson not found</Text>
        </View>
      </ScreenBackground>
    );
  }

  if (phase === 'reading') {
    return (
      <ScreenBackground>
        <ScrollView style={s.scrollView} contentContainerStyle={s.scrollContent}>
          <BackButton onPress={() => navigation.goBack()} />

          <Text style={s.lessonCounter}>
            Lesson {lessonOrder} of {totalLessonsInCourse}
          </Text>

          <Text style={[ts.pageTitle, s.readingTitle]}>{lesson.title}</Text>

          <Text style={s.readingBody}>
            {getLessonReadableContent(lesson)}
          </Text>

          <Pressable onPress={handleStartQuestions}>
            <View style={[ts.primaryBtn, s.actionBtnSpacing]}>
              <Text style={ts.primaryBtnText}>Start Questions</Text>
            </View>
          </Pressable>
        </ScrollView>
      </ScreenBackground>
    );
  }

  const progressPercent =
    ((currentQuestionIndex + 1) / Math.max(totalQuestions, 1)) * 100;

  const isActionEnabled =
    supportsLocalChecking && !hasChecked
      ? canContinue
      : canContinue || (supportsLocalChecking && hasChecked);

  const isAdvanceDisabled =
    submitting || (!supportsLocalChecking && !canContinue);

  return (
    <ScreenBackground>
      <ScrollView style={s.scrollView} contentContainerStyle={s.scrollContent}>
        <View style={s.questionHeader}>
          <Pressable
            onPress={() => {
              Alert.alert('Leave Lesson?', 'Your progress on this attempt will be lost.', [
                { text: 'Stay', style: 'cancel' },
                { text: 'Leave', style: 'destructive', onPress: () => navigation.goBack() },
              ]);
            }}
          >
            <View style={s.exitBtn}>
              <Text style={s.exitBtnText}>{'\u2715'}</Text>
            </View>
          </Pressable>
          <View style={s.questionHeaderText}>
            <Text style={s.questionCounter}>
              Question {currentQuestionIndex + 1} of {totalQuestions}
            </Text>
            {usesRemoteVerification && (
              <Text style={s.scoredOnSubmit}>Scored on submit</Text>
            )}
          </View>
        </View>

        <View style={[ts.progressBarBg, s.progressBarMargin]}>
          <View
            style={[ts.progressBarFill, { width: `${progressPercent}%` }]}
          />
        </View>

        <Text style={[ts.pageTitle, s.promptText]}>
          {currentQuestion?.prompt}
        </Text>

        {currentQuestion?.type === 'mcq' && (
          <View style={s.optionsContainer}>
            {currentQuestion.options?.map((option) => {
              const optionId = typeof option === 'string' ? option : option.id;
              const optionText = typeof option === 'string' ? option : option.text;

              let borderColor = T.borderDormant;
              let bgColor = T.bgCard;

              if (supportsLocalChecking && hasChecked && currentQuestion.correctAnswer) {
                if (optionText === currentQuestion.correctAnswer) {
                  borderColor = T.green;
                  bgColor = 'rgba(62,230,138,0.08)';
                } else if (
                  optionText === selectedOption &&
                  optionText !== currentQuestion.correctAnswer
                ) {
                  borderColor = T.crimson;
                  bgColor = 'rgba(255,68,102,0.08)';
                }
              } else if (optionText === selectedOption) {
                borderColor = T.amber;
                bgColor = T.bgCardActive;
              }

              return (
                <Pressable
                  key={optionId}
                  onPress={() => {
                    if (!hasChecked || !supportsLocalChecking) {
                      setSelectedOption(optionText);
                    }
                  }}
                  disabled={supportsLocalChecking && hasChecked}
                >
                  <ParchmentCard
                    style={{
                      borderColor,
                      backgroundColor: bgColor,
                    }}
                    opacity={0.2}
                  >
                    <Text style={s.optionText}>{optionText}</Text>
                  </ParchmentCard>
                </Pressable>
              );
            })}
          </View>
        )}

        {currentQuestion?.type === 'short_text' && (
          <View style={s.shortTextContainer}>
            <TextInput
              style={[
                s.textInput,
                supportsLocalChecking && hasChecked
                  ? isCorrect
                    ? s.textInputCorrect
                    : s.textInputIncorrect
                  : null,
              ]}
              placeholderTextColor={T.textMuted}
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
              <Text style={s.correctAnswerHint}>
                Correct answer:{' '}
                <Text style={s.correctAnswerValue}>
                  {currentQuestion.correctAnswer}
                </Text>
              </Text>
            )}
          </View>
        )}

        {supportsLocalChecking && hasChecked && (
          <Text
            style={[
              s.feedbackText,
              { color: isCorrect ? T.green : T.crimson },
            ]}
          >
            {isCorrect ? 'Correct!' : 'Incorrect'}
          </Text>
        )}

        {usesRemoteVerification && (
          <Text style={s.remoteInfoText}>
            Answers are verified by the lesson API after you finish the lesson.
          </Text>
        )}

        <View style={s.actionBtnSpacing}>
          {supportsLocalChecking && !hasChecked ? (
            <Pressable
              onPress={handleCheck}
              disabled={!canContinue}
            >
              <View style={canContinue ? ts.primaryBtn : s.disabledBtn}>
                <Text
                  style={
                    canContinue ? ts.primaryBtnText : s.disabledBtnText
                  }
                >
                  {currentQuestion?.type === 'mcq' ? 'Check Answer' : 'Submit'}
                </Text>
              </View>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => {
                void handleAdvance();
              }}
              disabled={isAdvanceDisabled}
            >
              <View style={isActionEnabled ? ts.primaryBtn : s.disabledBtn}>
                {submitting ? (
                  <ActivityIndicator color={T.textPrimary} />
                ) : (
                  <Text
                    style={
                      isActionEnabled ? ts.primaryBtnText : s.disabledBtnText
                    }
                  >
                    {isLastQuestion ? 'See Results' : 'Next Question'}
                  </Text>
                )}
              </View>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </ScreenBackground>
  );
}

const s = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notFoundText: {
    fontSize: 14,
    color: T.textSecondary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingBottom: 40,
  },
  lessonCounter: {
    fontSize: 12,
    color: T.textMuted,
    marginTop: 4,
  },
  readingTitle: {
    marginTop: 12,
    marginBottom: 0,
  },
  readingBody: {
    fontSize: 15,
    lineHeight: 22,
    color: T.textSecondary,
    marginTop: 16,
  },
  actionBtnSpacing: {
    marginTop: 24,
    marginBottom: 32,
  },
  btnPressed: {
    opacity: 0.85,
  },
  questionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
  questionHeaderText: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  exitBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: T.borderDormant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exitBtnText: {
    fontSize: 16,
    color: T.textMuted,
    fontWeight: '600',
  },
  questionCounter: {
    fontSize: 12,
    color: T.textSecondary,
  },
  scoredOnSubmit: {
    fontSize: 11,
    color: T.textMuted,
  },
  progressBarMargin: {
    marginTop: 8,
  },
  promptText: {
    marginTop: 24,
    marginBottom: 0,
    fontSize: 18,
  },
  optionsContainer: {
    marginTop: 16,
    gap: 12,
  },
  optionText: {
    fontSize: 15,
    color: T.textPrimary,
  },
  shortTextContainer: {
    marginTop: 16,
  },
  textInput: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.borderDormant,
    backgroundColor: T.bgCard,
    color: T.textPrimary,
    padding: 16,
    fontSize: 15,
  },
  textInputCorrect: {
    borderColor: T.green,
    backgroundColor: 'rgba(62,230,138,0.08)',
  },
  textInputIncorrect: {
    borderColor: T.crimson,
    backgroundColor: 'rgba(255,68,102,0.08)',
  },
  correctAnswerHint: {
    marginTop: 8,
    fontSize: 13,
    color: T.textSecondary,
  },
  correctAnswerValue: {
    fontWeight: '600',
    color: T.green,
  },
  feedbackText: {
    marginTop: 16,
    fontSize: 15,
    fontWeight: '600',
  },
  remoteInfoText: {
    marginTop: 16,
    fontSize: 13,
    color: T.textMuted,
  },
  disabledBtn: {
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledBtnText: {
    fontFamily: 'Georgia',
    fontSize: 14,
    fontWeight: '800',
    color: T.textMuted,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
  },
});
