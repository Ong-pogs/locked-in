import { createContext, useContext, useRef, useState, useCallback, useEffect, type ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import Constants from 'expo-constants';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface DungeonContextType {
  isLoaded: boolean;
  sceneReady: boolean;
  loadProgress: number;
  webviewError: string | null;
  show: () => void;
  hide: () => void;
  sendMessage: (type: string, payload: Record<string, any>) => void;
  onMessage: (handler: (data: any) => void) => () => void;
  /** Set overlay content rendered above the WebView */
  setOverlay: (content: ReactNode) => void;
}

const DungeonContext = createContext<DungeonContextType | null>(null);

export function useDungeon() {
  const ctx = useContext(DungeonContext);
  if (!ctx) throw new Error('useDungeon must be used within DungeonProvider');
  return ctx;
}

// ---------------------------------------------------------------------------
// Dev host resolution (same as before)
// ---------------------------------------------------------------------------
function getDevHost(): string {
  try {
    const debuggerHost =
      Constants.expoConfig?.hostUri ??
      (Constants.manifest2 as any)?.extra?.expoGo?.debuggerHost ??
      (Constants.manifest as any)?.debuggerHost;
    if (debuggerHost) {
      const ip = debuggerHost.split(':')[0];
      if (ip) return ip;
    }
  } catch {}
  return '192.168.1.103';
}

const DEV_URI = `http://${getDevHost()}:5173`;
const IS_DEV = __DEV__;
const DUNGEON_ASSET = require('../../web/dungeon/dist/index.html');

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export function DungeonProvider({ children }: { children: ReactNode }) {
  const webViewRef = useRef<WebView>(null);
  const [visible, setVisible] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [webviewError, setWebviewError] = useState<string | null>(null);
  const [overlayContent, setOverlayContent] = useState<ReactNode>(null);

  // Message handlers registered by consumers
  const handlersRef = useRef<Set<(data: any) => void>>(new Set());

  const show = useCallback(() => {
    setVisible(true);
    if (!isLoaded) setIsLoaded(true);
  }, [isLoaded]);

  const hide = useCallback(() => {
    setVisible(false);
  }, []);

  const sendMessage = useCallback((type: string, payload: Record<string, any>) => {
    const msg = JSON.stringify({ type, payload });
    webViewRef.current?.injectJavaScript(
      `window.dispatchBridgeMessage('${msg.replace(/'/g, "\\'")}'); true;`
    );
  }, []);

  const onMessage = useCallback((handler: (data: any) => void) => {
    handlersRef.current.add(handler);
    return () => { handlersRef.current.delete(handler); };
  }, []);

  const setOverlay = useCallback((content: ReactNode) => {
    setOverlayContent(content);
  }, []);

  const handleWebViewMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);

      // Handle internal lifecycle events
      if (data.type === 'sceneReady') {
        setSceneReady(true);
      } else if (data.type === 'loadProgress') {
        setLoadProgress(data.payload?.progress ?? 0);
      } else if (data.type === 'console') {
        console.log(`[WebView ${data.payload?.level}]`, data.payload?.message);
      }

      // Forward ALL messages to registered handlers
      for (const handler of handlersRef.current) {
        handler(data);
      }
    } catch {
      // ignore malformed messages
    }
  }, []);

  const webviewSource = IS_DEV ? { uri: DEV_URI } : DUNGEON_ASSET;

  const ctx: DungeonContextType = {
    isLoaded,
    sceneReady,
    loadProgress,
    webviewError,
    show,
    hide,
    sendMessage,
    onMessage,
    setOverlay,
  };

  return (
    <DungeonContext.Provider value={ctx}>
      {children}

      {/* Persistent WebView — mounted once isLoaded, never unmounted */}
      {isLoaded && (
        <View
          style={[styles.container, !visible && styles.hidden]}
          pointerEvents={visible ? 'auto' : 'none'}
        >
          <WebView
            ref={webViewRef}
            style={styles.webview}
            source={webviewSource}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            allowFileAccess
            allowUniversalAccessFromFileURLs
            mediaPlaybackRequiresUserAction={false}
            onMessage={handleWebViewMessage}
            onError={(e) => {
              const msg = `${e.nativeEvent.description} (code ${e.nativeEvent.code})`;
              console.warn('[Dungeon] WebView error:', msg);
              setWebviewError(msg);
            }}
            onHttpError={(e) => console.warn('[Dungeon] HTTP error:', e.nativeEvent.statusCode)}
            mixedContentMode="always"
            injectedJavaScript={`
              (function() {
                var origLog = console.log;
                var origErr = console.error;
                var origWarn = console.warn;
                function post(level, args) {
                  try {
                    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
                      JSON.stringify({ type: 'console', payload: { level: level, message: Array.from(args).map(String).join(' ') } })
                    );
                  } catch(e) {}
                }
                console.log = function() { post('log', arguments); origLog.apply(console, arguments); };
                console.error = function() { post('error', arguments); origErr.apply(console, arguments); };
                console.warn = function() { post('warn', arguments); origWarn.apply(console, arguments); };
                window.onerror = function(msg, url, line) {
                  post('error', ['UNCAUGHT: ' + msg + ' at ' + url + ':' + line]);
                };
                window.addEventListener('unhandledrejection', function(e) {
                  post('error', ['UNHANDLED REJECTION: ' + (e.reason && e.reason.message || e.reason)]);
                });
              })();
              true;
            `}
          />
        </View>
      )}

      {/* Overlay portal — content set by the active screen, rendered above the WebView */}
      {visible && overlayContent != null && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {overlayContent}
        </View>
      )}
    </DungeonContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
    backgroundColor: '#050508',
  },
  hidden: {
    // Move offscreen instead of display:none — keeps WebView alive
    position: 'absolute',
    left: -9999,
    top: -9999,
    width: 1,
    height: 1,
    opacity: 0,
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
