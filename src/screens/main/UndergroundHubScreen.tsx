import { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, Pressable, Modal, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MainStackParamList } from '@/navigation/types';
import { useFlameStore, useSceneStore, useStreakStore, useTokenStore, useBrewStore } from '@/stores';
import { useCourseStore } from '@/stores/courseStore';
import { useDungeon } from '@/components/DungeonProvider';

type HubNav = NativeStackNavigationProp<MainStackParamList>;

export function UndergroundHubScreen() {
  const navigation = useNavigation<HubNav>();
  const insets = useSafeAreaInsets();
  const {
    show, hide, sendMessage, onMessage, setOverlay,
    sceneReady, loadProgress, webviewError,
  } = useDungeon();
  const [bookModalVisible, setBookModalVisible] = useState(false);

  // Store subscriptions
  const flameState = useFlameStore((s) => s.flameState);
  const lightIntensity = useFlameStore((s) => s.lightIntensity);
  const currentViewpoint = useSceneStore((s) => s.currentViewpoint);
  const roomPhase = useSceneStore((s) => s.roomPhase);
  const currentStreak = useStreakStore((s) => s.currentStreak);
  const activeCourseIds = useCourseStore((s) => s.activeCourseIds);

  // Initialize mock data
  useCourseStore.getState().initializeMockData();

  // Guard: no active courses → CourseBrowser
  useEffect(() => {
    if (activeCourseIds.length === 0) {
      navigation.replace('CourseBrowser');
    }
  }, [activeCourseIds.length, navigation]);

  // Show/hide WebView on screen focus/blur
  useFocusEffect(
    useCallback(() => {
      show();
      // Zoom camera back to default viewpoint when returning to dungeon
      sendMessage('cameraGoBack', {});
      return () => {
        setOverlay(null);
        hide();
      };
    }, [show, hide, setOverlay, sendMessage]),
  );

  // Register message handlers
  useEffect(() => {
    return onMessage((data) => {
      switch (data.type) {
        case 'objectTapped': {
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
          if (modeId) {
            const spent = useTokenStore.getState().spendTokens(1);
            if (spent) {
              useBrewStore.getState().startBrew(modeId);
            }
          }
          break;
        }

        case 'brewCancelled':
          useBrewStore.getState().cancelBrew();
          break;

        case 'viewpointChanged':
          if (data.payload?.viewpoint) {
            useSceneStore.getState().setViewpoint(data.payload.viewpoint);
          }
          break;
      }
    });
  }, [onMessage, navigation]);

  // Send initial state once scene is ready
  useEffect(() => {
    if (!sceneReady) return;
    sendMessage('initState', {
      flameState,
      lightIntensity,
      viewpoint: currentViewpoint,
      roomPhase,
      streak: currentStreak,
    });
  }, [sceneReady]); // eslint-disable-line react-hooks/exhaustive-deps

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
              <Text style={overlayStyles.profileBtnText}>{'\u2666'}</Text>
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
      </>,
    );
  }, [sceneReady, loadProgress, webviewError, bookModalVisible, insets.top, navigation, setOverlay]);

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
        <Pressable style={overlayStyles.modalContent} onPress={() => {}}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={overlayStyles.modalTitle}>
              {course?.title ?? 'No Course'}
            </Text>
            <Text style={overlayStyles.modalSubtitle}>
              {course?.description ?? ''}
            </Text>

            <View style={overlayStyles.modalCard}>
              <Text style={overlayStyles.cardLabel}>Progress</Text>
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
            </View>

            <View style={overlayStyles.modalCard}>
              <Text style={overlayStyles.cardLabel}>Last Learned</Text>
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
            </View>

            <View style={overlayStyles.actionGrid}>
              <Pressable style={overlayStyles.actionBtn} onPress={() => {}}>
                <Text style={overlayStyles.actionIcon}>{'\u{1F3CB}\uFE0F'}</Text>
                <Text style={overlayStyles.actionLabel}>Practice</Text>
              </Pressable>
              <Pressable style={overlayStyles.actionBtn} onPress={() => {}}>
                <Text style={overlayStyles.actionIcon}>{'\u{1F9E9}'}</Text>
                <Text style={overlayStyles.actionLabel}>Puzzle</Text>
              </Pressable>
              <Pressable style={overlayStyles.actionBtn} onPress={() => {}}>
                <Text style={overlayStyles.actionIcon}>{'\u{1F4D6}'}</Text>
                <Text style={overlayStyles.actionLabel}>Dictionary</Text>
              </Pressable>
              <Pressable style={overlayStyles.actionBtn} onPress={onBrowseCourses}>
                <Text style={overlayStyles.actionIcon}>{'\u{1F4DA}'}</Text>
                <Text style={overlayStyles.actionLabel}>All Courses</Text>
              </Pressable>
            </View>

            {nextLesson ? (
              <Pressable
                style={overlayStyles.startBtn}
                onPress={() => onStartLesson(nextLesson.id, nextLesson.courseId)}
              >
                <Text style={overlayStyles.startBtnText}>
                  Start Lesson {nextLesson.order}: {nextLesson.title}
                </Text>
              </Pressable>
            ) : (
              <View style={[overlayStyles.startBtn, overlayStyles.startBtnDone]}>
                <Text style={overlayStyles.startBtnText}>All Lessons Complete!</Text>
              </View>
            )}
          </ScrollView>
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
    backgroundColor: 'rgba(20, 20, 22, 0.85)',
    borderRadius: 20,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(60, 60, 64, 0.6)',
  },
  profileBtnText: {
    color: '#f59e0b',
    fontSize: 16,
    fontWeight: '700',
  },

  // ====== Book Modal ======
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#141416',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 40,
    maxHeight: '80%',
    borderTopWidth: 1,
    borderColor: '#2a2a2e',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
  },
  modalSubtitle: {
    color: '#888',
    fontSize: 14,
    marginTop: 6,
    lineHeight: 20,
  },
  modalCard: {
    backgroundColor: '#1c1c1e',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a2e',
    padding: 16,
    marginTop: 16,
  },
  cardLabel: {
    color: '#999',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardValue: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 4,
  },
  cardMuted: {
    color: '#666',
    fontSize: 13,
    marginTop: 4,
  },
  progressTrack: {
    height: 6,
    backgroundColor: '#2a2a2e',
    borderRadius: 3,
    marginTop: 10,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#f59e0b',
    borderRadius: 3,
  },
  actionGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: '#1c1c1e',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a2e',
    paddingVertical: 14,
    alignItems: 'center',
  },
  actionIcon: {
    fontSize: 20,
  },
  actionLabel: {
    color: '#999',
    fontSize: 11,
    marginTop: 6,
    fontWeight: '500',
  },
  startBtn: {
    backgroundColor: '#7c3aed',
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 20,
    alignItems: 'center',
  },
  startBtnDone: {
    backgroundColor: '#166534',
  },
  startBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
