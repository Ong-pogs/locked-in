import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { MainStackParamList } from '@/navigation/types';
import { useStreakStore } from '@/stores/streakStore';
import { ScreenBackground, ParchmentCard, T, ts } from '@/theme';

type Nav = NativeStackNavigationProp<MainStackParamList, 'LessonResult'>;
type Route = RouteProp<MainStackParamList, 'LessonResult'>;

export function LessonResultScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { score, totalQuestions, accepted = true, questionResults = [] } = route.params;

  const currentStreak = useStreakStore((s) => s.currentStreak);

  const correctCount = Math.round((score / 100) * totalQuestions);

  const scoreColor =
    score >= 80
      ? T.green
      : score >= 50
        ? T.amber
        : T.crimson;
  const subjectiveResults = questionResults.filter(
    (question) => typeof question.feedbackSummary === 'string' && question.feedbackSummary.length > 0,
  );

  return (
    <ScreenBackground>
      <View style={s.container}>
        {/* Score */}
        <Text style={[s.scoreText, { color: scoreColor }]}>{score}%</Text>
        <Text style={s.scoreSub}>
          {correctCount}/{totalQuestions} Questions Correct
        </Text>

        {/* Reward cards */}
        <View style={s.cardGroup}>
          {/* Verification status */}
          <ParchmentCard style={s.card}>
            <Text style={ts.cardLabel}>Lesson Status</Text>
            <Text
              style={[
                s.cardValueLarge,
                { color: accepted ? T.green : T.amber },
              ]}
            >
              {accepted ? 'Verified' : 'Needs Improvement'}
            </Text>
          </ParchmentCard>

          {/* Streak status */}
          <ParchmentCard style={s.card}>
            <Text style={ts.cardLabel}>Current Streak</Text>
            <Text style={[s.cardValueLarge, { color: T.amber }]}>
              {currentStreak} day{currentStreak !== 1 ? 's' : ''}
            </Text>
          </ParchmentCard>
        </View>

        {subjectiveResults.length > 0 && (
          <View style={s.feedbackGroup}>
            {subjectiveResults.map((question) => (
              <ParchmentCard key={question.questionId} style={s.feedbackCard}>
                <Text style={ts.cardLabel}>Answer Feedback</Text>
                <Text style={s.feedbackPrompt}>
                  {question.prompt}
                </Text>
                <Text style={s.feedbackMeta}>
                  Score: {question.score}
                  {' \u00B7 '}
                  {question.accepted ? 'Accepted' : 'Not accepted yet'}
                </Text>
                <Text style={s.feedbackBody}>
                  {question.feedbackSummary}
                </Text>
              </ParchmentCard>
            ))}
          </View>
        )}

        {/* Return button */}
        <Pressable onPress={() => navigation.navigate('DungeonHome')}>
          <View style={[ts.primaryBtn, s.returnBtn]}>
            <Text style={ts.primaryBtnText}>Return to Hub</Text>
          </View>
        </Pressable>
      </View>
    </ScreenBackground>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  scoreText: {
    fontSize: 56,
    fontWeight: '700',
    fontFamily: 'Georgia',
    letterSpacing: 1,
  },
  scoreSub: {
    marginTop: 8,
    fontSize: 16,
    color: T.textSecondary,
  },
  cardGroup: {
    marginTop: 28,
    width: '100%',
    gap: 14,
  },
  card: {
    padding: 18,
  },
  cardValueLarge: {
    fontSize: 22,
    fontWeight: '700',
    marginTop: 4,
  },
  feedbackGroup: {
    marginTop: 20,
    width: '100%',
    gap: 12,
  },
  feedbackCard: {
    padding: 16,
  },
  feedbackPrompt: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '600',
    color: T.textPrimary,
  },
  feedbackMeta: {
    marginTop: 8,
    fontSize: 11,
    fontFamily: 'monospace',
    color: T.textSecondary,
    letterSpacing: 0.5,
  },
  feedbackBody: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 20,
    color: T.textPrimary,
  },
  returnBtn: {
    marginTop: 28,
    width: '100%',
  },
});
