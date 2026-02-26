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

  // React Native WebView bridge
  if ((window as any).ReactNativeWebView?.postMessage) {
    (window as any).ReactNativeWebView.postMessage(json);
    return;
  }

  // Dev fallback: log to console
  console.log('[bridge → RN]', msg);
}

// Expose on window so RN can call it
(window as any).dispatchBridgeMessage = dispatchBridgeMessage;
