import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ImageBackground, ActivityIndicator, Text, Pressable, Modal, ScrollView, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MainStackParamList } from '@/navigation/types';
import { useFlameStore, useSceneStore, useStreakStore, useUserStore } from '@/stores';
import { useCourseStore } from '@/stores/courseStore';
import { useDungeon } from '@/components/DungeonProvider';
import { GuidedTour } from '@/components/GuidedTour';
import { T, woodBg, parchmentBg } from '@/theme';
import { User, BookOpen, FlaskConical, Puzzle, Scroll, Library, ChevronRight } from 'lucide-react-native';

type HubNav = NativeStackNavigationProp<MainStackParamList>;

export function UndergroundHubScreen() {
  const navigation = useNavigation<HubNav>();
  const insets = useSafeAreaInsets();
  const {
    show, hide, sendMessage, onMessage, setOverlay, setTourOverlay,
    sceneReady, loadProgress, webviewError,
  } = useDungeon();
  const dungeonTourCompleted = useUserStore((s) => s.dungeonTourCompleted);
  const completeDungeonTour = useUserStore((s) => s.completeDungeonTour);
  const [showTour, setShowTour] = useState(false);
  const [bookModalVisible, setBookModalVisible] = useState(false);
  const [cinematicPhase, setCinematicPhase] = useState<'idle' | 'text' | 'playing' | 'done'>('idle');
  const cinematicOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const prevGauntletActive = useRef<boolean | null>(null);

  // Store subscriptions
  const flameState = useFlameStore((s) => s.flameState);
  const lightIntensity = useFlameStore((s) => s.lightIntensity);
  const currentViewpoint = useSceneStore((s) => s.currentViewpoint);
  const roomPhase = useSceneStore((s) => s.roomPhase);
  const currentStreak = useStreakStore((s) => s.currentStreak);
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const activeCourseIds = useCourseStore((s) => s.activeCourseIds);
  const courseStates = useCourseStore((s) => s.courseStates);
  const setActiveCourse = useCourseStore((s) => s.setActiveCourse);
  const lockedCourseIds = useMemo(
    () =>
      activeCourseIds.filter((courseId) =>
        Boolean(courseStates[courseId]?.lockAccountAddress),
      ),
    [activeCourseIds, courseStates],
  );
  const gauntletActive = activeCourseId ? courseStates[activeCourseId]?.gauntletActive ?? false : false;

  // Initialize mock data
  useCourseStore.getState().initializeMockData();

  // Guard: no locked courses → CourseBrowser (only when focused)
  useEffect(() => {
    if (lockedCourseIds.length === 0 && navigation.isFocused()) {
      navigation.replace('CourseBrowser');
    }
  }, [lockedCourseIds.length, navigation]);

  useEffect(() => {
    if (lockedCourseIds.length > 0 && (!activeCourseId || !lockedCourseIds.includes(activeCourseId))) {
      setActiveCourse(lockedCourseIds[0]);
    }
  }, [activeCourseId, lockedCourseIds, setActiveCourse]);

  // Show/hide WebView on screen focus/blur
  useFocusEffect(
    useCallback(() => {
      show();
      sendMessage('cameraGoBack', {});
      return () => {
        hide();
      };
    }, [show, hide, sendMessage]),
  );

  // Register message handlers (stable deps — read store state via getState inside handler)
  useEffect(() => {
    return onMessage((data) => {
      switch (data.type) {
        case 'objectTapped': {
          if (!navigation.isFocused()) break;
          const objectId = data.payload?.objectId;
          switch (objectId) {
            case 'book':
            case 'bookshelf':
              setBookModalVisible(true);
              break;
            case 'alchemy':
            case 'alchemy_table':
            case 'alchemy_shelf':
            case 'alchemy_yield':
              navigation.navigate('Alchemy');
              break;
            case 'noticeboard':
              navigation.navigate('Leaderboard');
              break;
            case 'old_chest':
              navigation.navigate('Inventory');
              break;
            case 'oil_lamp_left':
            case 'oil_lamp_center':
            case 'oil_lamp_right':
              navigation.navigate('StreakStatus');
              break;
          }
          break;
        }

        case 'brewConfirmed': {
          const modeId = data.payload?.modeId;
          const { activeCourseId: acid, courseStates: cs } = useCourseStore.getState();
          if (modeId && acid) {
            const activeState = cs[acid];
            if (activeState?.fuelCounter > 0 && !activeState?.gauntletActive) {
              useCourseStore.getState().startBrewForCourse(acid, modeId);
            }
          }
          break;
        }

        case 'brewCancelled': {
          const { activeCourseId: acid } = useCourseStore.getState();
          if (acid) {
            useCourseStore.getState().cancelBrewForCourse(acid);
          }
          break;
        }

        case 'viewpointChanged':
          if (data.payload?.viewpoint) {
            useSceneStore.getState().setViewpoint(data.payload.viewpoint);
          }
          break;
      }
    });
  }, [onMessage, navigation]);

  // Show guided tour on first visit after scene loads
  useEffect(() => {
    if (sceneReady && !dungeonTourCompleted && cinematicPhase === 'idle') {
      // Small delay so the scene is visually settled
      const timer = setTimeout(() => setShowTour(true), 800);
      return () => clearTimeout(timer);
    }
  }, [sceneReady, dungeonTourCompleted, cinematicPhase]);

  // Send initial state + lighting mode once scene is ready
  useEffect(() => {
    if (!sceneReady) return;
    sendMessage('initState', {
      flameState,
      lightIntensity,
      viewpoint: currentViewpoint,
      roomPhase,
      streak: currentStreak,
    });
    // Delay slightly so all dungeon lights are fully created before toggling
    setTimeout(() => {
      sendMessage('setLightingMode', { mode: gauntletActive ? 'gauntlet' : 'normal' });
    }, 300);
    prevGauntletActive.current = gauntletActive;
  }, [sceneReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect gauntlet → post-gauntlet transition and trigger cinematic
  useEffect(() => {
    if (!sceneReady) return;
    // Only trigger when gauntlet was active and now it's not
    if (prevGauntletActive.current === true && gauntletActive === false) {
      // Phase 1: black screen + text
      setCinematicPhase('text');
      // Snap camera to lamp close-up while screen is black
      sendMessage('snapToLamps', {});
      Animated.timing(cinematicOpacity, { toValue: 1, duration: 600, useNativeDriver: true }).start(() => {
        Animated.timing(textOpacity, { toValue: 1, duration: 800, useNativeDriver: true }).start(() => {
          // Hold text for 2s
          setTimeout(() => {
            // Phase 2: fade out text
            Animated.timing(textOpacity, { toValue: 0, duration: 600, useNativeDriver: true }).start(() => {
              // Phase 3: fade out black overlay — user sees lamp close-up
              Animated.timing(cinematicOpacity, { toValue: 0, duration: 1200, useNativeDriver: true }).start(() => {
                // Unmount overlay so touches work
                setCinematicPhase('idle');
                // Phase 4: light up lamps then zoom out
                sendMessage('playGauntletCinematic', {});
              });
            });
          }, 2000);
        });
      });
    }
    prevGauntletActive.current = gauntletActive;
  }, [gauntletActive, sceneReady, sendMessage, cinematicOpacity, textOpacity]);

  // Listen for cinematic completion from dungeon
  useEffect(() => {
    return onMessage((data) => {
      if (data.type === 'cinematicComplete') {
        setCinematicPhase('idle');
      }
    });
  }, [onMessage]);

  // Sync flame state changes
  useEffect(() => {
    if (!sceneReady) return;
    sendMessage('flameState', { state: flameState, intensity: lightIntensity });
  }, [flameState, lightIntensity, sceneReady, sendMessage]);

  // Sync viewpoint
  useEffect(() => {
    if (!sceneReady) return;
    sendMessage('setViewpoint', { viewpoint: currentViewpoint });
  }, [currentViewpoint, sceneReady, sendMessage]);

  // Sync room phase
  useEffect(() => {
    if (!sceneReady) return;
    sendMessage('setRoomPhase', { phase: roomPhase });
  }, [roomPhase, sceneReady, sendMessage]);

  // Update overlay content (profile button, loading, book modal)
  useEffect(() => {
    setOverlay(
      <>
        {/* Loading overlay */}
        {!sceneReady && (
          <View style={overlayStyles.loadingOverlay}>
            <ActivityIndicator size="large" color="#ff8c42" />
            <Text style={overlayStyles.loadingText}>
              Loading dungeon... {Math.round(loadProgress * 100)}%
            </Text>
            {webviewError && (
              <Text style={overlayStyles.errorText}>{webviewError}</Text>
            )}
          </View>
        )}

        {/* Profile button (top-right) */}
        {sceneReady && (
          <View style={[overlayStyles.topBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
            <Pressable
              style={overlayStyles.profileBtn}
              onPress={() => navigation.navigate('Profile')}
            >
              <User size={18} color={T.amber} strokeWidth={2.5} />
            </Pressable>
          </View>
        )}

        {/* Book modal */}
        <BookModal
          visible={bookModalVisible}
          onClose={() => {
            setBookModalVisible(false);
            sendMessage('cameraGoBack', {});
          }}
          onStartLesson={(lessonId, courseId) => {
            setBookModalVisible(false);
            navigation.navigate('Lesson', { lessonId, courseId });
          }}
          onBrowseCourses={() => {
            setBookModalVisible(false);
            navigation.navigate('CourseBrowser');
          }}
        />

        {/* Gauntlet completion cinematic overlay */}
        {cinematicPhase !== 'idle' && (
          <Animated.View
            style={[overlayStyles.cinematicOverlay, { opacity: cinematicOpacity }]}
            pointerEvents={cinematicPhase === 'text' ? 'auto' : 'none'}
          >
            <Animated.Text style={[overlayStyles.cinematicText, { opacity: textOpacity }]}>
              THE DUNGEON RECOGNISES{'\n'}YOUR EFFORTS...
            </Animated.Text>
          </Animated.View>
        )}
      </>,
    );
  }, [sceneReady, loadProgress, webviewError, bookModalVisible, sendMessage, cinematicPhase, cinematicOpacity, textOpacity, insets.top, navigation, setOverlay]);

  const handleTourStepChange = useCallback(
    (viewpoint: string) => sendMessage('setViewpoint', { viewpoint }),
    [sendMessage],
  );

  const handleTourComplete = useCallback(() => {
    setShowTour(false);
    completeDungeonTour();
    sendMessage('cameraGoBack', {});
  }, [completeDungeonTour, sendMessage]);

  // Tour overlay — separate from main overlay so it never remounts
  useEffect(() => {
    if (showTour && sceneReady) {
      setTourOverlay(
        <GuidedTour
          onStepChange={handleTourStepChange}
          onComplete={handleTourComplete}
        />,
      );
    } else {
      setTourOverlay(null);
    }
  }, [showTour, sceneReady, handleTourStepChange, handleTourComplete, setTourOverlay]);

  // Clear tour overlay on unmount
  useEffect(() => {
    return () => setTourOverlay(null);
  }, [setTourOverlay]);

  // Screen renders nothing — all UI is via the overlay portal
  return <View style={{ flex: 1, backgroundColor: 'transparent' }} />;
}

// ---------------------------------------------------------------------------
// Book Modal
// ---------------------------------------------------------------------------
function BookModal({
  visible,
  onClose,
  onStartLesson,
  onBrowseCourses,
}: {
  visible: boolean;
  onClose: () => void;
  onStartLesson: (lessonId: string, courseId: string) => void;
  onBrowseCourses: () => void;
}) {
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const courses = useCourseStore((s) => s.courses);
  const lessons = useCourseStore((s) => s.lessons);
  const lessonProgress = useCourseStore((s) => s.lessonProgress);

  const course = activeCourseId
    ? courses.find((c) => c.id === activeCourseId) ?? null
    : courses[0] ?? null;
  const courseLessons = course
    ? (lessons[course.id] ?? []).sort((a, b) => a.order - b.order)
    : [];

  const nextLesson = courseLessons.find((l) => !lessonProgress[l.id]?.completed);
  const completedLessons = courseLessons.filter((l) => lessonProgress[l.id]?.completed);
  const lastCompleted = completedLessons.length > 0
    ? completedLessons[completedLessons.length - 1]
    : null;
  const lastScore = lastCompleted ? lessonProgress[lastCompleted.id]?.score : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={overlayStyles.modalBackdrop} onPress={onClose}>
        <Pressable onPress={() => { }}>
          <ImageBackground
            source={woodBg}
            resizeMode="cover"
            style={overlayStyles.modalContent}
            imageStyle={{ borderTopLeftRadius: 24, borderTopRightRadius: 24, opacity: 0.7 }}
          >
            {/* Decorative top bar */}
            <View style={overlayStyles.modalTopBar}>
              <View style={overlayStyles.modalTopBarLine} />
              <Text style={overlayStyles.modalTopBarDiamond}>{'\u25C6'}</Text>
              <View style={overlayStyles.modalTopBarLine} />
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={overlayStyles.modalTitle}>
                {course?.title ?? 'No Course'}
              </Text>
              <Text style={overlayStyles.modalSubtitle}>
                {course?.description ?? ''}
              </Text>

              {/* Progress card */}
              <ImageBackground
                source={parchmentBg}
                resizeMode="cover"
                style={overlayStyles.modalCard}
                imageStyle={{ borderRadius: 10, opacity: 0.25 }}
              >
                <Text style={overlayStyles.cardLabel}>PROGRESS</Text>
                <View style={overlayStyles.progressTrack}>
                  <View
                    style={[
                      overlayStyles.progressFill,
                      {
                        width: course
                          ? `${(course.completedLessons / course.totalLessons) * 100}%`
                          : '0%',
                      },
                    ]}
                  />
                </View>
                <Text style={overlayStyles.cardMuted}>
                  {course?.completedLessons ?? 0}/{course?.totalLessons ?? 0} lessons
                </Text>
              </ImageBackground>

              {/* Last Learned card */}
              <ImageBackground
                source={parchmentBg}
                resizeMode="cover"
                style={overlayStyles.modalCard}
                imageStyle={{ borderRadius: 10, opacity: 0.25 }}
              >
                <Text style={overlayStyles.cardLabel}>LAST LEARNED</Text>
                {lastCompleted ? (
                  <>
                    <Text style={overlayStyles.cardValue}>{lastCompleted.title}</Text>
                    <Text style={overlayStyles.cardMuted}>
                      Score: {lastScore ?? 0}%
                    </Text>
                  </>
                ) : (
                  <Text style={overlayStyles.cardMuted}>No lessons completed yet</Text>
                )}
              </ImageBackground>

              {/* Action grid */}
              <View style={overlayStyles.actionGrid}>
                <Pressable style={overlayStyles.actionBtn} onPress={() => { }}>
                  <FlaskConical size={20} color={T.amber} strokeWidth={1.8} />
                  <Text style={overlayStyles.actionLabel}>Practice</Text>
                </Pressable>
                <Pressable style={overlayStyles.actionBtn} onPress={() => { }}>
                  <Puzzle size={20} color={T.amber} strokeWidth={1.8} />
                  <Text style={overlayStyles.actionLabel}>Puzzle</Text>
                </Pressable>
                <Pressable style={overlayStyles.actionBtn} onPress={() => { }}>
                  <Scroll size={20} color={T.amber} strokeWidth={1.8} />
                  <Text style={overlayStyles.actionLabel}>Dictionary</Text>
                </Pressable>
                <Pressable style={overlayStyles.actionBtn} onPress={onBrowseCourses}>
                  <Library size={20} color={T.amber} strokeWidth={1.8} />
                  <Text style={overlayStyles.actionLabel}>Courses</Text>
                </Pressable>
              </View>

              {/* Start / Done button */}
              {nextLesson ? (
                <Pressable
                  style={overlayStyles.startBtn}
                  onPress={() => onStartLesson(nextLesson.id, nextLesson.courseId)}
                >
                  <BookOpen size={18} color="#1A1000" strokeWidth={2.5} style={{ marginRight: 8 }} />
                  <Text style={overlayStyles.startBtnText}>
                    Lesson {nextLesson.order}: {nextLesson.title}
                  </Text>
                </Pressable>
              ) : (
                <View style={[overlayStyles.startBtn, overlayStyles.startBtnDone]}>
                  <Text style={[overlayStyles.startBtnText, { color: T.green }]}>All Lessons Complete!</Text>
                </View>
              )}
            </ScrollView>
          </ImageBackground>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const overlayStyles = StyleSheet.create({
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#050508',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#888',
    fontSize: 14,
    marginTop: 12,
  },
  errorText: {
    color: '#f44',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 20,
  },

  // ====== Top Bar (Profile only) ======
  topBar: {
    position: 'absolute',
    top: 0,
    right: 0,
    paddingHorizontal: 12,
  },
  profileBtn: {
    backgroundColor: 'rgba(14,14,28,0.88)',
    borderRadius: 22,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: T.borderAlive,
  },

  // ====== Book Modal ======
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(3,3,6,0.82)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: T.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 0,
    paddingBottom: 40,
    maxHeight: '100%',
    borderTopWidth: 1,
    borderColor: T.borderAlive,
    overflow: 'hidden',
  },
  modalTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 16,
    paddingBottom: 14,
  },
  modalTopBarLine: {
    width: 40,
    height: 1,
    backgroundColor: `${T.amber}40`,
  },
  modalTopBarDiamond: {
    fontSize: 7,
    color: `${T.amber}60`,
  },
  modalTitle: {
    color: T.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    fontFamily: 'Georgia',
    letterSpacing: 0.5,
  },
  modalSubtitle: {
    color: T.textSecondary,
    fontSize: 13,
    marginTop: 6,
    lineHeight: 20,
  },
  modalCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.borderDormant,
    padding: 16,
    marginTop: 14,
    backgroundColor: T.bgCard,
    overflow: 'hidden',
  },
  cardLabel: {
    color: T.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 2,
    fontFamily: 'monospace',
    marginBottom: 6,
  },
  cardValue: {
    color: T.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    marginTop: 2,
  },
  cardMuted: {
    color: T.textMuted,
    fontSize: 12,
    marginTop: 4,
    fontFamily: 'monospace',
  },
  progressTrack: {
    height: 5,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: T.amber,
    borderRadius: 3,
  },
  actionGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: T.bgCard,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.borderDormant,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 6,
  },
  actionLabel: {
    color: T.textSecondary,
    fontSize: 10,
    fontWeight: '600',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  startBtn: {
    backgroundColor: T.amber,
    borderRadius: 10,
    paddingVertical: 15,
    marginTop: 18,
    marginBottom: 4,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#E8B860',
    elevation: 6,
  },
  startBtnDone: {
    backgroundColor: 'rgba(62,230,138,0.12)',
    borderColor: 'rgba(62,230,138,0.25)',
    elevation: 0,
  },
  startBtnText: {
    color: '#1A1000',
    fontSize: 13,
    fontWeight: '800',
    fontFamily: 'Georgia',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },

  // ====== Cinematic Overlay ======
  cinematicOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cinematicText: {
    color: '#d4a44c',
    fontSize: 20,
    fontWeight: '300',
    textAlign: 'center',
    lineHeight: 32,
    fontFamily: 'Georgia',
    fontStyle: 'italic',
    letterSpacing: 1,
  },
});
