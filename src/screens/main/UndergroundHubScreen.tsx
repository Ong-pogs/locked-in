import { useRef, useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, Pressable, Modal, ScrollView } from 'react-native';
import Constants from 'expo-constants';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MainStackParamList } from '@/navigation/types';
import { useFlameStore, useSceneStore, useStreakStore } from '@/stores';
import { useCourseStore } from '@/stores/courseStore';

type HubNav = NativeStackNavigationProp<MainStackParamList, 'UndergroundHub'>;

/**
 * Bundled dungeon asset (from web/dungeon/dist/index.html).
 * Note: Metro config must allow .html assets.
 */
const DUNGEON_ASSET = require('../../../web/dungeon/dist/index.html');

/**
 * Dynamically get the Mac's IP address so physical phones can connect to the Vite server.
 */
let hostIp = 'localhost';
if (Constants.experienceUrl) {
  const match = Constants.experienceUrl.match(/\/\/([^:]+)/);
  if (match) hostIp = match[1];
}

/**
 * Dev mode: load from Vite dev server.
 * Prod: load the inlined single-file HTML built by vite-plugin-singlefile.
 */
const DEV_URI = `http://${hostIp}:5173`;
const IS_DEV = __DEV__;

export function UndergroundHubScreen() {
  const navigation = useNavigation<HubNav>();
  const webViewRef = useRef<WebView>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [bookModalVisible, setBookModalVisible] = useState(false);

  // Store subscriptions
  const flameState = useFlameStore((s) => s.flameState);
  const lightIntensity = useFlameStore((s) => s.lightIntensity);
  const currentViewpoint = useSceneStore((s) => s.currentViewpoint);
  const roomPhase = useSceneStore((s) => s.roomPhase);
  const currentStreak = useStreakStore((s) => s.currentStreak);

  // Initialize mock data so course info is available
  useCourseStore.getState().initializeMockData();

  // Helper: send message to WebView
  const sendToWebView = useCallback((type: string, payload: Record<string, any>) => {
    const msg = JSON.stringify({ type, payload });
    webViewRef.current?.injectJavaScript(
      `window.dispatchBridgeMessage('${msg.replace(/'/g, "\\'")}'); true;`
    );
  }, []);

  // Send initial state once scene is ready
  useEffect(() => {
    if (!sceneReady) return;
    sendToWebView('initState', {
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
    sendToWebView('flameState', { state: flameState, intensity: lightIntensity });
  }, [flameState, lightIntensity, sceneReady, sendToWebView]);

  // Sync viewpoint (when RN forces a viewpoint)
  useEffect(() => {
    if (!sceneReady) return;
    sendToWebView('setViewpoint', { viewpoint: currentViewpoint });
  }, [currentViewpoint, sceneReady, sendToWebView]);

  // Sync room phase
  useEffect(() => {
    if (!sceneReady) return;
    sendToWebView('setRoomPhase', { phase: roomPhase });
  }, [roomPhase, sceneReady, sendToWebView]);

  // Handle messages from WebView
  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);

        switch (data.type) {
          case 'sceneReady':
            setSceneReady(true);
            break;

          case 'loadProgress':
            setLoadProgress(data.payload?.progress ?? 0);
            break;

          case 'objectTapped': {
            const objectId = data.payload?.objectId;
            switch (objectId) {
              case 'book':
              case 'bookshelf':
                setBookModalVisible(true);
                break;
              case 'fireplace':
                navigation.navigate('FlameDashboard');
                break;
              case 'alchemy':
                navigation.navigate('Alchemy');
                break;
              case 'noticeboard':
                navigation.navigate('Leaderboard');
                break;
              case 'character':
                navigation.navigate('Profile');
                break;
            }
            break;
          }

          case 'viewpointChanged':
            if (data.payload?.viewpoint) {
              useSceneStore.getState().setViewpoint(data.payload.viewpoint);
            }
            break;
        }
      } catch {
        // ignore malformed messages
      }
    },
    [navigation],
  );

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        style={[styles.webview, !sceneReady && styles.hidden]}
        source={IS_DEV ? { uri: DEV_URI } : DUNGEON_ASSET}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        mediaPlaybackRequiresUserAction={false}
        onMessage={handleMessage}
        onError={(e) => console.warn('WebView error:', e.nativeEvent)}
        mixedContentMode="always"
      />

      {/* Loading overlay */}
      {!sceneReady && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#ff8c42" />
          <Text style={styles.loadingText}>
            Loading dungeon... {Math.round(loadProgress * 100)}%
          </Text>
        </View>
      )}

      {/* Book modal */}
      <BookModal
        visible={bookModalVisible}
        onClose={() => setBookModalVisible(false)}
        onStartLesson={(lessonId, courseId) => {
          setBookModalVisible(false);
          navigation.navigate('Lesson', { lessonId, courseId });
        }}
        onBrowseCourses={() => {
          setBookModalVisible(false);
          navigation.navigate('CourseBrowser');
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Book Modal — popup when tapping the book
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
  const courses = useCourseStore((s) => s.courses);
  const lessons = useCourseStore((s) => s.lessons);
  const lessonProgress = useCourseStore((s) => s.lessonProgress);

  // Find the active course (first one for now)
  const course = courses[0];
  const courseLessons = course ? (lessons[course.id] ?? []).sort((a, b) => a.order - b.order) : [];

  // Find next incomplete lesson
  const nextLesson = courseLessons.find((l) => !lessonProgress[l.id]?.completed);
  // Find last completed lesson
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
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalContent} onPress={() => { }}>
          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Header */}
            <Text style={styles.modalTitle}>
              {course?.title ?? 'No Course'}
            </Text>
            <Text style={styles.modalSubtitle}>
              {course?.description ?? ''}
            </Text>

            {/* Progress summary */}
            <View style={styles.modalCard}>
              <Text style={styles.cardLabel}>Progress</Text>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: course
                        ? `${(course.completedLessons / course.totalLessons) * 100}%`
                        : '0%',
                    },
                  ]}
                />
              </View>
              <Text style={styles.cardMuted}>
                {course?.completedLessons ?? 0}/{course?.totalLessons ?? 0} lessons
              </Text>
            </View>

            {/* Last learned */}
            <View style={styles.modalCard}>
              <Text style={styles.cardLabel}>Last Learned</Text>
              {lastCompleted ? (
                <>
                  <Text style={styles.cardValue}>{lastCompleted.title}</Text>
                  <Text style={styles.cardMuted}>
                    Score: {lastScore ?? 0}%
                  </Text>
                </>
              ) : (
                <Text style={styles.cardMuted}>No lessons completed yet</Text>
              )}
            </View>

            {/* Action grid */}
            <View style={styles.actionGrid}>
              <Pressable style={styles.actionBtn} onPress={() => { }}>
                <Text style={styles.actionIcon}>{'🏋️'}</Text>
                <Text style={styles.actionLabel}>Practice</Text>
              </Pressable>
              <Pressable style={styles.actionBtn} onPress={() => { }}>
                <Text style={styles.actionIcon}>{'🧩'}</Text>
                <Text style={styles.actionLabel}>Puzzle</Text>
              </Pressable>
              <Pressable style={styles.actionBtn} onPress={() => { }}>
                <Text style={styles.actionIcon}>{'📖'}</Text>
                <Text style={styles.actionLabel}>Dictionary</Text>
              </Pressable>
              <Pressable style={styles.actionBtn} onPress={onBrowseCourses}>
                <Text style={styles.actionIcon}>{'📚'}</Text>
                <Text style={styles.actionLabel}>All Courses</Text>
              </Pressable>
            </View>

            {/* Start Lesson button */}
            {nextLesson ? (
              <Pressable
                style={styles.startBtn}
                onPress={() => onStartLesson(nextLesson.id, nextLesson.courseId)}
              >
                <Text style={styles.startBtnText}>
                  Start Lesson {nextLesson.order}: {nextLesson.title}
                </Text>
              </Pressable>
            ) : (
              <View style={[styles.startBtn, styles.startBtnDone]}>
                <Text style={styles.startBtnText}>All Lessons Complete!</Text>
              </View>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050508',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  hidden: {
    opacity: 0,
  },
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

  // Modal
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

  // Cards
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

  // Progress bar
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

  // Action grid
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

  // Start button
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
