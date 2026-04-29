'use client';

import {
  createContext,
  useContext,
  useRef,
  useState,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { useUserStore } from '@/stores/userStore';
import { TourOverlay } from './TourOverlay';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface DungeonContextType {
  isLoaded: boolean;
  sceneReady: boolean;
  loadProgress: number;
  iframeError: string | null;
  show: () => void;
  hide: () => void;
  sendMessage: (type: string, payload: Record<string, unknown>) => void;
  onMessage: (handler: (data: Record<string, unknown>) => void) => () => void;
  setOverlay: (content: ReactNode) => void;
}

const DungeonContext = createContext<DungeonContextType | null>(null);

export function useDungeon() {
  const ctx = useContext(DungeonContext);
  if (!ctx) throw new Error('useDungeon must be used within DungeonProvider');
  return ctx;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DUNGEON_URL =
  process.env.NEXT_PUBLIC_DUNGEON_URL ?? 'https://dist-ochre-kappa-70.vercel.app';

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export function DungeonProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Suppress iframe + lifecycle on the village route so we don't pay the 3D
  // bandwidth/CPU cost there. Consumers' show/hide/sendMessage become no-ops.
  const isVillageRoute = pathname?.startsWith('/village') ?? false;

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [visible, setVisible] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [iframeError, setIframeError] = useState<string | null>(null);
  const [overlayContent, setOverlayContent] = useState<ReactNode>(null);
  const [showTour, setShowTour] = useState(false);

  // Message handlers registered by consumers
  const handlersRef = useRef<Set<(data: Record<string, unknown>) => void>>(new Set());

  const show = useCallback(() => {
    if (isVillageRoute) return;
    setVisible(true);
    if (!isLoaded) setIsLoaded(true);
  }, [isLoaded, isVillageRoute]);

  const hide = useCallback(() => {
    setVisible(false);
  }, []);

  // Send message to dungeon iframe via postMessage
  // The dungeon listens for 'message' events and forwards to dispatchBridgeMessage
  const sendMessage = useCallback(
    (type: string, payload: Record<string, unknown>) => {
      const json = JSON.stringify({ type, payload });
      iframeRef.current?.contentWindow?.postMessage(json, '*');
    },
    [],
  );

  const onMessage = useCallback(
    (handler: (data: Record<string, unknown>) => void) => {
      handlersRef.current.add(handler);
      return () => {
        handlersRef.current.delete(handler);
      };
    },
    [],
  );

  const setOverlay = useCallback((content: ReactNode) => {
    setOverlayContent(content);
  }, []);

  // Listen for messages from the dungeon iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // Only accept messages from the dungeon origin
      if (!event.origin.includes(new URL(DUNGEON_URL).hostname)) return;

      // Dungeon sends JSON strings via postMessage, not objects
      let data: Record<string, unknown>;
      try {
        data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        return; // ignore malformed messages
      }
      if (!data || typeof data !== 'object') return;

      // Handle internal lifecycle events
      if (data.type === 'sceneReady') {
        setSceneReady(true);
      } else if (data.type === 'loadProgress') {
        const payload = data.payload as Record<string, unknown> | undefined;
        setLoadProgress((payload?.progress as number) ?? 0);
      }

      // Forward all messages to registered handlers
      for (const h of handlersRef.current) {
        h(data);
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Trigger dungeon tour for first-time users after scene is ready
  useEffect(() => {
    if (!sceneReady) return;
    const { dungeonTourCompleted } = useUserStore.getState();
    if (dungeonTourCompleted) return;

    const t = setTimeout(() => setShowTour(true), 1000);
    return () => clearTimeout(t);
  }, [sceneReady]);

  const handleTourComplete = useCallback(() => {
    setShowTour(false);
    useUserStore.getState().completeDungeonTour();
  }, []);

  const ctx = useMemo<DungeonContextType>(
    () => ({
      isLoaded,
      sceneReady,
      loadProgress,
      iframeError,
      show,
      hide,
      sendMessage,
      onMessage,
      setOverlay,
    }),
    [isLoaded, sceneReady, loadProgress, iframeError, show, hide, sendMessage, onMessage, setOverlay],
  );

  return (
    <DungeonContext.Provider value={ctx}>
      {children}

      {/* Persistent iframe — mounted once isLoaded, kept alive offscreen when hidden.
          On /village we never mount: no iframe network/CPU cost on the new hub. */}
      {isLoaded && !isVillageRoute && (
        <div
          className={`fixed inset-0 z-0 bg-[#050508] ${
            !visible ? 'opacity-0 pointer-events-none -left-[9999px] w-px h-px' : ''
          }`}
        >
          <iframe
            ref={iframeRef}
            src={DUNGEON_URL}
            className="w-full h-full border-0"
            allow="autoplay"
            onLoad={() => setIsLoaded(true)}
            onError={() => setIframeError('Failed to load dungeon scene.')}
          />
        </div>
      )}

      {/* Overlay — rendered above the iframe */}
      {visible && !isVillageRoute && overlayContent != null && (
        <div className="fixed inset-0 z-10 pointer-events-none">
          <div className="pointer-events-auto">{overlayContent}</div>
        </div>
      )}

      {/* Dungeon tour for first-time users */}
      {visible && showTour && !isVillageRoute && (
        <TourOverlay
          sendMessage={sendMessage}
          onMessage={onMessage}
          onComplete={handleTourComplete}
        />
      )}
    </DungeonContext.Provider>
  );
}
