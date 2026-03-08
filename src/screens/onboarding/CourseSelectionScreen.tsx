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
import type { OnboardingStackParamList } from '@/navigation/types';
import { useCourseStore, useUserStore } from '@/stores';
import {
  fetchLockAccountSnapshot,
  hasLockVaultConfig,
} from '@/services/solana';
import type { Course, CourseDifficulty, CourseCategory } from '@/types';

const woodBg = require('../../../assets/wood.png');
const parchmentBg = require('../../../assets/partchmentpaper.png');

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'CourseSelection'>;

// ── Color system (Dead Cells: saturated midtones on deep darks) ──

const C = {
  bg: '#06060C',
  bgCard: 'rgba(14,14,28,0.88)',
  bgCardSelected: 'rgba(18,16,32,0.94)',
  amber: '#D4A04A',
  amberDim: '#8B6914',
  amberGlow: 'rgba(212,160,74,0.15)',
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
  beginner: '\u2B21',   // hexagon
  intermediate: '\u25CE', // bullseye
  advanced: '\u2B1F',    // pentagon
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

// ── Course Card ──

function CourseCard({
  course,
  index,
  selected,
  onSelect,
}: {
  course: Course;
  index: number;
  selected: boolean;
  onSelect: () => void;
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

  return (
    <Animated.View style={{
      opacity: fadeIn,
      transform: [{ translateY: fadeIn.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
    }}>
      <Pressable onPress={onSelect} style={({ pressed }) => pressed && { opacity: 0.85 }}>
        <ImageBackground
          source={parchmentBg}
          resizeMode="cover"
          style={[
            s.card,
            selected && s.cardSelected,
            selected && { borderColor: `${accentColor}35` },
          ]}
          imageStyle={{ borderRadius: 9, opacity: selected ? 0.4 : 0.3 }}
        >
          {/* Corner marks */}
          {selected && (
            <>
              <CornerMark position="tl" />
              <CornerMark position="tr" />
              <CornerMark position="br" />
              <CornerMark position="bl" />
            </>
          )}

          {/* Breathing border glow */}
          {selected && (
            <BreathingBorder color={accentColor} />
          )}

          {/* Top row: sigil + tags + difficulty */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Sigil char={sigil} color={accentColor} active={selected} />
            <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', flex: 1 }}>
              <Tag label={course.difficulty} color={accentColor} />
              <Tag label={course.category} color={catColor} />
            </View>
            <DifficultyFlasks level={difficultyLevel} />
          </View>

          {/* Title */}
          <Text style={[s.cardTitle, selected && { color: C.textPrimary }]}>
            {course.title}
          </Text>

          {/* Description */}
          <Text style={s.cardDesc} numberOfLines={2}>
            {course.description}
          </Text>

          {/* Stats row */}
          <StatsRow course={course} accentColor={accentColor} />
        </ImageBackground>
      </Pressable>
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

// ── Main Screen ──

export function CourseSelectionScreen() {
  const navigation = useNavigation<Nav>();
  const courses = useCourseStore((s) => s.courses);
  const contentLoading = useCourseStore((s) => s.contentLoading);
  const contentError = useCourseStore((s) => s.contentError);
  const contentInitialized = useCourseStore((s) => s.contentInitialized);
  const initializeContent = useCourseStore((s) => s.initializeContent);
  const activateCourse = useCourseStore((s) => s.activateCourse);
  const syncLockSnapshot = useCourseStore((s) => s.syncLockSnapshot);
  const walletAddress = useUserStore((s) => s.walletAddress);
  const completeGauntlet = useUserStore((s) => s.completeGauntlet);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scanningLocks, setScanningLocks] = useState(false);

  useEffect(() => {
    if (!contentInitialized && !contentLoading) {
      void initializeContent(__DEV__);
    }
  }, [contentInitialized, contentLoading, initializeContent]);

  // Auto-detect existing on-chain locks and restore state
  useEffect(() => {
    if (!walletAddress || !hasLockVaultConfig() || courses.length === 0) {
      return;
    }

    let cancelled = false;
    setScanningLocks(true);

    const scanCourses = async () => {
      for (const course of courses) {
        if (cancelled) return;
        try {
          const snapshot = await fetchLockAccountSnapshot({
            ownerAddress: walletAddress,
            courseId: course.id,
          });

          if (cancelled) return;

          // Found an existing lock — restore state and navigate
          const startMs = new Date(snapshot.lockStartDate).getTime();
          const endMs = new Date(snapshot.lockEndDate).getTime();
          const totalDays = Math.max(
            14,
            Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)) - snapshot.extensionDays,
          );
          const durations = [14, 30, 45, 60, 90, 180, 365] as const;
          const closestDuration =
            durations.find((d) => d === totalDays) ??
            [...durations].reverse().find((d) => d <= totalDays) ??
            14;

          activateCourse(course.id, {
            amount: Number(snapshot.principalAmountUi),
            duration: closestDuration,
            lockAccountAddress: snapshot.lockAccountAddress,
            skrAmount: Number(snapshot.skrLockedAmountUi),
          });
          syncLockSnapshot(course.id, snapshot);
          completeGauntlet();
          return;
        } catch {
          // No lock found for this course — continue scanning
        }
      }

      if (!cancelled) {
        setScanningLocks(false);
      }
    };

    void scanCourses();
    return () => {
      cancelled = true;
    };
  }, [activateCourse, completeGauntlet, courses, syncLockSnapshot, walletAddress]);

  const selectedCourse = selectedId ? courses.find((c) => c.id === selectedId) : null;

  return (
    <ImageBackground source={woodBg} style={s.root} resizeMode="cover" imageStyle={{ opacity: 0.6 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={s.header}>
            {/* Decorative line */}
            <View style={s.decoLine}>
              <View style={s.decoLineBar} />
              <Text style={s.decoDiamond}>{'\u25C6'}</Text>
              <View style={s.decoLineBar} />
            </View>

            <Text style={s.headerTitle}>
              Choose Your{'\n'}
              <Text style={{ color: C.amber }}>Path</Text>
            </Text>

            <Text style={s.headerSub}>
              Mastering your craft through proof of effort.
            </Text>
          </View>

          {/* Scanning for existing locks */}
          {scanningLocks && (
            <View style={s.statusBox}>
              <Text style={s.statusText}>Scanning for existing on-chain locks...</Text>
            </View>
          )}

          {/* Loading / Error */}
          {contentLoading && courses.length === 0 && (
            <View style={s.statusBox}>
              <Text style={s.statusText}>Syncing course catalog...</Text>
            </View>
          )}
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

          {/* Course cards */}
          <View style={{ gap: 12 }}>
            {courses.map((course, i) => (
              <CourseCard
                key={course.id}
                course={course}
                index={i}
                selected={selectedId === course.id}
                onSelect={() => setSelectedId(
                  selectedId === course.id ? null : course.id,
                )}
              />
            ))}
          </View>

          {/* Empty state */}
          {courses.length === 0 && !contentLoading && !contentError && (
            <View style={s.statusBox}>
              <Text style={s.statusText}>No courses available.</Text>
            </View>
          )}
        </ScrollView>

        {/* Fixed CTA */}
        {selectedCourse && (
          <View style={s.ctaContainer}>
            <Pressable
              onPress={() => navigation.navigate('Deposit', { courseId: selectedCourse.id })}
            >
              <View style={s.ctaBtn}>
                <Text style={s.ctaBtnText}>
                  {'\u25C6'}  BEGIN DESCENT  {'\u25C6'}
                </Text>
              </View>
            </Pressable>
          </View>
        )}
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
    paddingTop: 20,
    paddingBottom: 28,
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

  // Cards
  card: {
    position: 'relative' as const,
    padding: 16,
    borderRadius: 10,
    backgroundColor: C.bgCard,
    borderWidth: 1,
    borderColor: C.borderDormant,
    overflow: 'hidden' as const,
  },
  cardSelected: {
    backgroundColor: C.bgCardSelected,
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
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
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
    textAlign: 'center' as const,
  },
  retryBtn: {
    marginTop: 12,
    alignSelf: 'center' as const,
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
    textTransform: 'uppercase' as const,
  },

  // CTA
  ctaContainer: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 18,
    paddingBottom: 32,
    paddingTop: 16,
    backgroundColor: `${C.bg}F5`,
  },
  ctaBtn: {
    paddingVertical: 16,
    borderRadius: 10,
    backgroundColor: C.amber,
    borderWidth: 1,
    borderColor: `${C.amber}50`,
    alignItems: 'center' as const,
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
    textTransform: 'uppercase' as const,
  },
});
