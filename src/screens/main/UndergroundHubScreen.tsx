import { useRef, useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MainStackParamList } from '@/navigation/types';
import { useFlameStore, useSceneStore, useStreakStore } from '@/stores';

type HubNav = NativeStackNavigationProp<MainStackParamList, 'UndergroundHub'>;

/**
 * Dev mode: load from Vite dev server.
 * Prod: load the inlined single-file HTML built by vite-plugin-singlefile.
 */
const DEV_URI = 'http://localhost:5173';
const IS_DEV = __DEV__;

export function UndergroundHubScreen() {
  const navigation = useNavigation<HubNav>();
  const webViewRef = useRef<WebView>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);

  // Store subscriptions
  const flameState = useFlameStore((s) => s.flameState);
  const lightIntensity = useFlameStore((s) => s.lightIntensity);
  const currentViewpoint = useSceneStore((s) => s.currentViewpoint);
  const roomPhase = useSceneStore((s) => s.roomPhase);
  const currentStreak = useStreakStore((s) => s.currentStreak);

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
              case 'bookshelf':
                navigation.navigate('CourseBrowser');
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
        source={IS_DEV ? { uri: DEV_URI } : { uri: DEV_URI }} // TODO: swap prod to { html: inlinedHtml }
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
    </View>
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
});
