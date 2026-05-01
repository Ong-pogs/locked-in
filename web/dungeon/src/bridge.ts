/**
 * WebView <-> React Native message bridge.
 *
 * RN sends messages via `injectJavaScript('window.dispatchBridgeMessage(...)')`.
 * We send messages back via `window.ReactNativeWebView.postMessage(...)`.
 */

export interface BridgeMessage {
  type: string;
  payload: Record<string, any>;
}

type BridgeHandler = (msg: BridgeMessage) => void;

let handler: BridgeHandler | null = null;

// Captured on first valid postMessage from the parent. Used to pin outbound
// messages to a known origin instead of broadcasting with '*'.
let parentOrigin: string | null = null;

/** Register the single handler for incoming RN messages. */
export function onBridgeMessage(fn: BridgeHandler) {
  handler = fn;
}

/** Called from RN via injectJavaScript. Exposed on window. */
export function dispatchBridgeMessage(raw: string) {
  try {
    const msg: BridgeMessage = JSON.parse(raw);
    handler?.(msg);
  } catch {
    // ignore malformed
  }
}

/** Send a message from WebView → RN. */
export function sendToRN(msg: BridgeMessage) {
  const json = JSON.stringify(msg);

  // React Native WebView bridge (iOS / Android)
  if ((window as any).ReactNativeWebView?.postMessage) {
    (window as any).ReactNativeWebView.postMessage(json);
    return;
  }

  // Web (iframe) fallback — react-native-webview on web uses window.parent.postMessage.
  // Use the captured parent origin once we've seen one inbound message;
  // until then fall back to '*' (initial sceneReady carries no sensitive data).
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(json, parentOrigin ?? '*');
    return;
  }

  // Standalone web — overlays are triggered by camera-arrived, not here
  console.log('[bridge → RN]', msg);
}

// Listen for camera-arrived — notify RN (overlays are handled by RN screens now)
window.addEventListener('camera-arrived', ((e: CustomEvent) => {
  const objectId = e.detail?.objectId as string;
  if (!objectId) return;
  sendToRN({ type: 'objectTapped', payload: { objectId } });
}) as EventListener);

// Expose on window so RN can call it via injectJavaScript
(window as any).dispatchBridgeMessage = dispatchBridgeMessage;

// Listen for postMessage from parent iframe host (Next.js PWA)
// This enables the same bridge when embedded as an iframe instead of a WebView
window.addEventListener('message', (event) => {
  if (event.source === window) return; // ignore own messages
  if (!parentOrigin && event.source === window.parent) {
    parentOrigin = event.origin;
  }
  const raw = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
  dispatchBridgeMessage(raw);
});
