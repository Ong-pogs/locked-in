import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Animated,
  Easing,
  ImageBackground,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MainStackParamList } from '@/navigation/types';
import { useCourseStore } from '@/stores/courseStore';
import type { Course, CourseDifficulty } from '@/types';

const woodBg = require('../../../assets/wood.png');
const parchmentBg = require('../../../assets/partchmentpaper.png');

type Nav = NativeStackNavigationProp<MainStackParamList>;

// ── Color system (Dead Cells palette) ──

const C = {
  bg: '#06060C',
  bgCard: 'rgba(14,14,28,0.88)',
  bgCardSelected: 'rgba(18,16,32,0.94)',
  amber: '#D4A04A',
  amberDim: '#8B6914',
  green: '#3EE68A',
  crimson: '#FF4466',
  teal: '#2AE8D4',
  violet: '#9945FF',
  rust: '#E8845A',
  textPrimary: '#E8DED0',
  textSecondary: 'rgba(255,255,255,0.42)',
  textMuted: 'rgba(255,255,255,0.22)',
  borderAlive: 'rgba(212,160,74,0.18)',
  borderDormant: 'rgba(255,255,255,0.06)',
};

const DIFFICULTY_COLORS: Record<CourseDifficulty, string> = {
  beginner: C.green,
  intermediate: C.teal,
  advanced: C.crimson,
};

const CATEGORY_COLORS: Record<string, string> = {
  solana: C.violet,
  web3: C.teal,
  defi: C.teal,
  security: C.crimson,
  rust: C.rust,
};

const DIFFICULTY_SIGILS: Record<CourseDifficulty, string> = {
  beginner: '\u2B21',
  intermediate: '\u25CE',
  advanced: '\u2B1F',
};

// ── Sub-components ──

function CornerMark({ position }: { position: 'tl' | 'tr' | 'br' | 'bl' }) {
  const base: ViewStyle = { position: 'absolute', width: 14, height: 14 };
  const pos: ViewStyle =
    position === 'tl' ? { top: -1, left: -1 } :
    position === 'tr' ? { top: -1, right: -1 } :
    position === 'br' ? { bottom: -1, right: -1 } :
    { bottom: -1, left: -1 };

  const hBar: ViewStyle = {
    position: 'absolute', height: 2, width: 10,
    backgroundColor: C.amber, opacity: 0.35,
    ...(position === 'tl' || position === 'tr' ? { top: 0 } : { bottom: 0 }),
    ...(position === 'tl' || position === 'bl' ? { left: 0 } : { right: 0 }),
  };
  const vBar: ViewStyle = {
    position: 'absolute', width: 2, height: 10,
    backgroundColor: C.amber, opacity: 0.35,
    ...(position === 'tl' || position === 'bl' ? { left: 0 } : { right: 0 }),
    ...(position === 'tl' || position === 'tr' ? { top: 0 } : { bottom: 0 }),
  };
  const dot: ViewStyle = {
    position: 'absolute', width: 3, height: 3, borderRadius: 1.5,
    backgroundColor: C.amber, opacity: 0.5,
    ...(position === 'tl' || position === 'tr' ? { top: 0 } : { bottom: 0 }),
    ...(position === 'tl' || position === 'bl' ? { left: 0 } : { right: 0 }),
  };

  return (
    <View style={[base, pos]} pointerEvents="none">
      <View style={hBar} />
      <View style={vBar} />
      <View style={dot} />
    </View>
  );
}

function DifficultyFlasks({ level }: { level: number }) {
  const fills = [C.green, C.teal, C.crimson];
  return (
    <View style={{ flexDirection: 'row', gap: 3, alignItems: 'center' }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{
          width: 8, height: 14, borderRadius: 3,
          backgroundColor: i < level ? fills[i] : 'rgba(255,255,255,0.06)',
          opacity: i < level ? 1 : 0.3,
          borderWidth: 0.5,
          borderColor: i < level ? `${fills[i]}40` : 'rgba(255,255,255,0.04)',
        }}>
          {i < level && (
            <View style={{
              position: 'absolute', bottom: 2, left: 1, right: 1, height: 4,
              borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)',
            }} />
          )}
        </View>
      ))}
    </View>
  );
}

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <View style={{
      paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4,
      backgroundColor: `${color}14`,
      borderWidth: 1, borderColor: `${color}30`,
    }}>
      <Text style={{
        fontSize: 9, fontWeight: '700', letterSpacing: 1,
        textTransform: 'uppercase', color,
        fontFamily: 'monospace',
      }}>
        {label}
      </Text>
    </View>
  );
}

function Sigil({ char, color, active }: { char: string; color: string; active: boolean }) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (active) {
      Animated.loop(
        Animated.timing(spin, {
          toValue: 1,
          duration: 12000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ).start();
    } else {
      spin.setValue(0);
    }
  }, [active, spin]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View style={{
      width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
      transform: [{ rotate }],
    }}>
      <Text style={{
        fontSize: 20, color: active ? color : 'rgba(255,255,255,0.1)',
        fontFamily: 'serif',
      }}>
        {char}
      </Text>
    </Animated.View>
  );
}

function BreathingBorder({ color }: { color: string }) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 2000,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [opacity]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: -1, left: -1, right: -1, bottom: -1,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: `${color}25`,
        opacity,
      }}
    />
  );
}

function StatsRow({ course, accentColor }: { course: Course; accentColor: string }) {
  return (
    <View style={s.statsRow}>
      <Text style={s.statText}>{course.totalModules ?? 1} mod</Text>
      <Text style={s.statDot}>{'\u00B7'}</Text>
      <Text style={s.statText}>{course.totalLessons} lessons</Text>
      <Text style={s.statDot}>{'\u00B7'}</Text>
      <Text style={s.statText}>{course.difficulty}</Text>
      <View style={{ flex: 1 }} />
      <Text style={[s.statText, { color: `${accentColor}70`, fontSize: 9 }]}>
        {course.category}
      </Text>
    </View>
  );
}

// ── Course Card (available courses) ──

function CourseCard({
  course,
  index,
  onPress,
  onEnroll,
}: {
  course: Course;
  index: number;
  onPress: () => void;
  onEnroll: () => void;
}) {
  const fadeIn = useRef(new Animated.Value(0)).current;
  const difficultyLevel =
    course.difficulty === 'beginner' ? 1 :
    course.difficulty === 'intermediate' ? 2 : 3;
  const accentColor = DIFFICULTY_COLORS[course.difficulty];
  const catColor = CATEGORY_COLORS[course.category] ?? C.teal;
  const sigil = DIFFICULTY_SIGILS[course.difficulty];

  useEffect(() => {
    Animated.timing(fadeIn, {
      toValue: 1,
      duration: 400,
      delay: 100 + index * 120,
      useNativeDriver: true,
    }).start();
  }, [fadeIn, index]);

  const progressPercent =
    course.totalLessons > 0
      ? (course.completedLessons / course.totalLessons) * 100
      : 0;

  return (
    <Animated.View style={{
      opacity: fadeIn,
      transform: [{ translateY: fadeIn.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
    }}>
      <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.85 }}>
        <ImageBackground
          source={parchmentBg}
          resizeMode="cover"
          style={s.card}
          imageStyle={{ borderRadius: 9, opacity: 0.35 }}
        >
          {/* Top row: sigil + tags + difficulty */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Sigil char={sigil} color={accentColor} active={false} />
            <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', flex: 1 }}>
              <Tag label={course.difficulty} color={accentColor} />
              <Tag label={course.category} color={catColor} />
            </View>
            <DifficultyFlasks level={difficultyLevel} />
          </View>

          {/* Title */}
          <Text style={s.cardTitle}>{course.title}</Text>

          {/* Description */}
          <Text style={s.cardDesc} numberOfLines={2}>{course.description}</Text>

          {/* Progress bar */}
          <View style={s.progressBarBg}>
            <View style={[s.progressBarFill, { width: `${progressPercent}%` }]} />
          </View>
          <Text style={s.progressText}>
            {course.completedLessons}/{course.totalLessons} lessons
          </Text>

          {/* Enroll button */}
          <View style={s.enrollBtn}>
            <Pressable
              style={{ width: '100%', alignItems: 'center' }}
              onPress={(e) => {
                e.stopPropagation?.();
                onEnroll();
              }}
            >
              <Text style={s.enrollBtnText}>
                {'\u25C6'}  LOCK & START  {'\u25C6'}
              </Text>
            </Pressable>
          </View>

          {/* Stats row */}
          <StatsRow course={course} accentColor={accentColor} />
        </ImageBackground>
      </Pressable>
    </Animated.View>
  );
}

// ── Active Course Card ──

function ActiveCourseCard({
  course,
  streak,
  gauntletDay,
  index,
  onPress,
}: {
  course: Course;
  streak: number;
  gauntletDay: number;
  index: number;
  onPress: () => void;
}) {
  const fadeIn = useRef(new Animated.Value(0)).current;
  const accentColor = C.amber;

  useEffect(() => {
    Animated.timing(fadeIn, {
      toValue: 1,
      duration: 400,
      delay: 80 + index * 100,
      useNativeDriver: true,
    }).start();
  }, [fadeIn, index]);

  return (
    <Animated.View style={{
      opacity: fadeIn,
      transform: [{ translateY: fadeIn.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
    }}>
      <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.85 }}>
        <ImageBackground
          source={parchmentBg}
          resizeMode="cover"
          style={[s.card, { borderColor: `${C.violet}35` }]}
          imageStyle={{ borderRadius: 9, opacity: 0.35 }}
        >
          {/* Corner marks */}
          <CornerMark position="tl" />
          <CornerMark position="tr" />
          <CornerMark position="br" />
          <CornerMark position="bl" />

          <BreathingBorder color={C.violet} />

          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={[s.cardTitle, { color: C.textPrimary, marginBottom: 6 }]}>
                {course.title}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={{ fontFamily: 'monospace', fontSize: 11, color: C.amber }}>
                  {'\u2739'} {streak} streak
                </Text>
                <Text style={{ fontFamily: 'monospace', fontSize: 11, color: C.violet }}>
                  Day {gauntletDay}
                </Text>
                <Text style={{ fontFamily: 'monospace', fontSize: 11, color: C.textMuted }}>
                  {course.completedLessons}/{course.totalLessons} lessons
                </Text>
              </View>
            </View>
            <Text style={{ fontSize: 18, color: C.textMuted }}>{'\u203A'}</Text>
          </View>
        </ImageBackground>
      </Pressable>
    </Animated.View>
  );
}

// ── Detail View ──

function CourseDetailView({
  course,
  isLocked,
  state,
  onBack,
  onDescend,
  onEnroll,
}: {
  course: Course;
  isLocked: boolean;
  state: import('@/types').CourseGameState | undefined;
  onBack: () => void;
  onDescend: () => void;
  onEnroll: () => void;
}) {
  const navigation = useNavigation<Nav>();
  const lessons = useCourseStore((s) => s.lessons)[course.id] ?? [];
  const lessonProgress = useCourseStore((s) => s.lessonProgress);
  const accentColor = DIFFICULTY_COLORS[course.difficulty];
  const progressPercent =
    course.totalLessons > 0
      ? (course.completedLessons / course.totalLessons) * 100
      : 0;

  return (
    <ImageBackground source={woodBg} style={s.root} resizeMode="cover" imageStyle={{ opacity: 0.6 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Back */}
          <Pressable onPress={onBack} style={{ paddingVertical: 12 }}>
            <Text style={{ fontFamily: 'monospace', fontSize: 12, color: C.textSecondary }}>
              {'\u2190'} Back to Courses
            </Text>
          </Pressable>

          {/* Title */}
          <Text style={[s.headerTitle, { fontSize: 22, textAlign: 'left', marginBottom: 14 }]}>
            {course.title}
          </Text>

          {/* Action button */}
          {isLocked ? (
            <Pressable
              style={({ pressed }) => [s.ctaBtn, { backgroundColor: C.violet }, pressed && { opacity: 0.8 }]}
              onPress={onDescend}
            >
              <Text style={[s.ctaBtnText, { color: '#fff' }]}>
                {'\u25C6'}  DESCEND  {'\u25C6'}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              style={({ pressed }) => [s.ctaBtn, pressed && { opacity: 0.8 }]}
              onPress={onEnroll}
            >
              <Text style={s.ctaBtnText}>
                {'\u25C6'}  LOCK & START  {'\u25C6'}
              </Text>
            </Pressable>
          )}

          {/* Progress card */}
          <ImageBackground
            source={parchmentBg}
            resizeMode="cover"
            style={[s.card, { marginTop: 16 }]}
            imageStyle={{ borderRadius: 9, opacity: 0.35 }}
          >
            <Text style={{ fontFamily: 'monospace', fontSize: 10, color: C.textSecondary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
              Progress
            </Text>
            <View style={s.progressBarBg}>
              <View style={[s.progressBarFill, { width: `${progressPercent}%` }]} />
            </View>
            <Text style={[s.progressText, { marginTop: 6 }]}>
              {course.completedLessons}/{course.totalLessons} lessons completed
            </Text>
            <Text style={[s.progressText]}>
              {course.totalModules ?? 1} module{(course.totalModules ?? 1) !== 1 ? 's' : ''}
            </Text>
            {isLocked && state && (
              <View style={{ flexDirection: 'row', gap: 16, marginTop: 8 }}>
                <Text style={{ fontFamily: 'monospace', fontSize: 11, color: C.amber }}>
                  {'\u2739'} Streak: {state.currentStreak}
                </Text>
                <Text style={{ fontFamily: 'monospace', fontSize: 11, color: C.violet }}>
                  Day {state.gauntletDay}
                </Text>
              </View>
            )}
          </ImageBackground>

          {/* Lock notice */}
          {!isLocked && (
            <ImageBackground
              source={parchmentBg}
              resizeMode="cover"
              style={[s.card, { marginTop: 12, borderColor: `${C.amber}20` }]}
              imageStyle={{ borderRadius: 9, opacity: 0.3 }}
            >
              <Text style={{ fontFamily: 'monospace', fontSize: 11, color: C.textSecondary, lineHeight: 18 }}>
                Lock this course first. Each course has its own deposit and lock duration.
              </Text>
            </ImageBackground>
          )}

          {/* Lesson list */}
          <Text style={[s.sectionLabel, { marginTop: 20 }]}>Lessons</Text>
          <View style={{ gap: 8 }}>
            {lessons
              .sort((a, b) => a.order - b.order)
              .map((lesson) => {
                const progress = lessonProgress[lesson.id];
                const isCompleted = progress?.completed;

                return (
                  <Pressable
                    key={lesson.id}
                    disabled={!isLocked}
                    onPress={() => {
                      if (!isLocked) return;
                      navigation.navigate('Lesson', {
                        lessonId: lesson.id,
                        courseId: course.id,
                      });
                    }}
                    style={({ pressed }) => [
                      !isLocked && { opacity: 0.5 },
                      pressed && isLocked && { opacity: 0.8 },
                    ]}
                  >
                    <ImageBackground
                      source={parchmentBg}
                      resizeMode="cover"
                      style={s.lessonRow}
                      imageStyle={{ borderRadius: 9, opacity: 0.3 }}
                    >
                      {/* Order circle */}
                      <View style={[
                        s.lessonCircle,
                        isCompleted && { backgroundColor: `${C.green}20`, borderColor: `${C.green}40` },
                      ]}>
                        {isCompleted ? (
                          <Text style={{ fontSize: 14, color: C.green }}>{'\u2713'}</Text>
                        ) : (
                          <Text style={{ fontSize: 13, fontWeight: '700', color: C.textMuted }}>
                            {lesson.order}
                          </Text>
                        )}
                      </View>

                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: C.textPrimary }}>
                          {lesson.title}
                        </Text>
                        {isCompleted && progress?.score != null && (
                          <Text style={{ fontFamily: 'monospace', fontSize: 10, color: C.textMuted, marginTop: 2 }}>
                            Score: {progress.score}%
                          </Text>
                        )}
                      </View>

                      {!isCompleted && isLocked && (
                        <Text style={{ fontSize: 16, color: C.textMuted }}>{'\u203A'}</Text>
                      )}
                    </ImageBackground>
                  </Pressable>
                );
              })}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ImageBackground>
  );
}

// ── Main Screen ──

export function CourseBrowserScreen() {
  const navigation = useNavigation<Nav>();
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);

  const courses = useCourseStore((s) => s.courses);
  const contentLoading = useCourseStore((s) => s.contentLoading);
  const contentError = useCourseStore((s) => s.contentError);
  const initializeContent = useCourseStore((s) => s.initializeContent);
  const activeCourseIds = useCourseStore((s) => s.activeCourseIds);
  const courseStates = useCourseStore((s) => s.courseStates);
  const setActiveCourse = useCourseStore((s) => s.setActiveCourse);

  const lockedCourseIds = activeCourseIds.filter((courseId) =>
    Boolean(courseStates[courseId]?.lockAccountAddress),
  );
  const isMainMenu = lockedCourseIds.length === 0;
  const activeCourses = courses.filter((c) => lockedCourseIds.includes(c.id));
  const availableCourses = courses.filter((c) => !lockedCourseIds.includes(c.id));

  const selectedCourse = selectedCourseId
    ? courses.find((c) => c.id === selectedCourseId) ?? null
    : null;

  const handleEnroll = (courseId: string) => {
    navigation.navigate('Deposit', { courseId });
  };

  const handleActiveCoursePress = (courseId: string) => {
    setActiveCourse(courseId);
    navigation.navigate('DungeonHome');
  };

  // ====== Detail View ======
  if (selectedCourse) {
    const isLocked = Boolean(courseStates[selectedCourse.id]?.lockAccountAddress);
    return (
      <CourseDetailView
        course={selectedCourse}
        isLocked={isLocked}
        state={courseStates[selectedCourse.id]}
        onBack={() => setSelectedCourseId(null)}
        onDescend={() => handleActiveCoursePress(selectedCourse.id)}
        onEnroll={() => handleEnroll(selectedCourse.id)}
      />
    );
  }

  // ====== List View ======
  return (
    <ImageBackground source={woodBg} style={s.root} resizeMode="cover" imageStyle={{ opacity: 0.6 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={s.header}>
            {isMainMenu || !navigation.canGoBack() ? null : (
              <Pressable onPress={() => navigation.goBack()} style={{ marginBottom: 8 }}>
                <Text style={{ fontFamily: 'monospace', fontSize: 12, color: C.textSecondary }}>
                  {'\u2190'} Back
                </Text>
              </Pressable>
            )}

            <View style={s.decoLine}>
              <View style={s.decoLineBar} />
              <Text style={s.decoDiamond}>{'\u25C6'}</Text>
              <View style={s.decoLineBar} />
            </View>

            <Text style={s.headerTitle}>Courses</Text>

            <Text style={s.headerSub}>
              Mastering your craft through proof of effort.
            </Text>
          </View>

          {/* Loading */}
          {contentLoading && courses.length === 0 && (
            <View style={s.statusBox}>
              <Text style={s.statusText}>Syncing lesson modules...</Text>
            </View>
          )}

          {/* Error */}
          {contentError && (
            <View style={[s.statusBox, { borderColor: 'rgba(255,68,102,0.15)' }]}>
              <Text style={[s.statusText, { color: 'rgba(255,68,102,0.6)' }]}>
                {contentError}
              </Text>
              <Pressable
                style={s.retryBtn}
                onPress={() => { void initializeContent(true); }}
              >
                <Text style={s.retryBtnText}>Retry</Text>
              </Pressable>
            </View>
          )}

          {/* Active Courses */}
          {activeCourses.length > 0 && (
            <View style={{ marginBottom: 20 }}>
              <Text style={s.sectionLabel}>Active Courses</Text>
              <View style={{ gap: 10 }}>
                {activeCourses.map((course, i) => {
                  const state = courseStates[course.id];
                  return (
                    <ActiveCourseCard
                      key={course.id}
                      course={course}
                      streak={state?.currentStreak ?? 0}
                      gauntletDay={state?.gauntletDay ?? 1}
                      index={i}
                      onPress={() => handleActiveCoursePress(course.id)}
                    />
                  );
                })}
              </View>
            </View>
          )}

          {/* Available Courses */}
          {activeCourses.length > 0 && availableCourses.length > 0 && (
            <Text style={s.sectionLabel}>Available Courses</Text>
          )}
          <View style={{ gap: 12 }}>
            {(activeCourses.length > 0 ? availableCourses : courses).map((course, i) => (
              <CourseCard
                key={course.id}
                course={course}
                index={i}
                onPress={() => setSelectedCourseId(course.id)}
                onEnroll={() => handleEnroll(course.id)}
              />
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ImageBackground>
  );
}

// ── Styles ──

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },

  // Header
  header: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 24,
  },
  decoLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  decoLineBar: {
    width: 30,
    height: 1,
    backgroundColor: `${C.amber}30`,
  },
  decoDiamond: {
    fontSize: 7,
    color: `${C.amber}50`,
  },
  headerTitle: {
    fontFamily: 'Georgia',
    fontSize: 26,
    fontWeight: '700',
    color: C.textPrimary,
    textAlign: 'center',
    letterSpacing: 0.5,
    lineHeight: 34,
    marginBottom: 8,
  },
  headerSub: {
    fontSize: 12,
    color: C.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },

  // Section labels
  sectionLabel: {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '700',
    color: C.textMuted,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },

  // Cards
  card: {
    position: 'relative',
    padding: 16,
    borderRadius: 10,
    backgroundColor: C.bgCard,
    borderWidth: 1,
    borderColor: C.borderDormant,
    overflow: 'hidden',
  },
  cardTitle: {
    fontFamily: 'Georgia',
    fontSize: 17,
    fontWeight: '700',
    color: '#B8B0A4',
    letterSpacing: 0.3,
    lineHeight: 22,
    marginBottom: 5,
  },
  cardDesc: {
    fontSize: 12,
    color: C.textSecondary,
    lineHeight: 18,
    marginBottom: 14,
  },

  // Stats row
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.borderDormant,
  },
  statText: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: C.textMuted,
  },
  statDot: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.08)',
  },

  // Progress bar
  progressBarBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
    marginTop: 4,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: C.amber,
  },
  progressText: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: C.textMuted,
    marginTop: 4,
  },

  // Enroll button
  enrollBtn: {
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#D4A04A',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E8B860',
    elevation: 8,
  },
  enrollBtnText: {
    fontFamily: 'Georgia',
    fontSize: 14,
    fontWeight: '800',
    color: '#1A1000',
    letterSpacing: 2.5,
    textTransform: 'uppercase',
  },

  // CTA button (detail view)
  ctaBtn: {
    paddingVertical: 16,
    borderRadius: 10,
    backgroundColor: C.amber,
    borderWidth: 1,
    borderColor: `${C.amber}50`,
    alignItems: 'center',
    shadowColor: C.amber,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  ctaBtnText: {
    fontFamily: 'Georgia',
    fontSize: 13,
    fontWeight: '700',
    color: C.bg,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },

  // Status / loading
  statusBox: {
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.borderDormant,
    backgroundColor: 'rgba(14,14,28,0.6)',
    marginBottom: 16,
  },
  statusText: {
    fontSize: 12,
    color: C.textSecondary,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 12,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: `${C.amber}30`,
    backgroundColor: 'rgba(212,160,74,0.08)',
  },
  retryBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: C.amber,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  // Lesson row (detail view)
  lessonRow: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 10,
    backgroundColor: C.bgCard,
    borderWidth: 1,
    borderColor: C.borderDormant,
    overflow: 'hidden',
  },
  lessonCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
});
